"""Incident orchestration state machine.

Incident:  DETECTED → ANALYZED → CONTAINING → CONTAINED | ATTENTION_REQUIRED
Action:    QUEUED → EXECUTING → SUCCEEDED | FAILED  (FAILED → QUEUED on retry)

Actions are scheduled on a timeline and advanced lazily whenever state is read,
which keeps the engine deterministic, restart-safe and easy to test (instant=True).
"""
import secrets
import threading

from .. import clock
from ..config import Config
from ..db import clean, get_db
from ..errors import ApiError
from . import adapters, ai_commander, audit, policy, risk
from .tokenizer import sanitize_tree

_lock = threading.RLock()
TERMINAL = {"SUCCEEDED", "FAILED"}


def _new_id() -> str:
    # Suffix always starts with a letter so IDs never look like phone numbers to the PII sieve.
    return f"INC-{clock.now_dt():%y%m%d}-{secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}{secrets.token_hex(2).upper()}"


def get_incident(incident_id: str) -> dict:
    inc = get_db().incidents.find_one({"_id": incident_id})
    if not inc:
        raise ApiError(404, "incident_not_found", f"Incident {incident_id} does not exist")
    return inc


def _set(incident_id: str, **fields):
    fields["updated_at"] = clock.now()
    get_db().incidents.update_one({"_id": incident_id}, {"$set": fields})


# ── Lifecycle ───────────────────────────────────────────────────────────────

def create_incident(*, source: str, title: str, threat_type: str, transcript: list[dict], metadata: dict,
                    client_privacy: dict, interventions: list[str], evidence_refs: list[str], seeded=False,
                    conditions: dict | None = None) -> dict:
    # Defense in depth: re-scan everything the client sent, even though it was tokenized at the edge.
    (title, threat_type, transcript), residual = sanitize_tree([title, threat_type, transcript])
    caller_lines = [l["text"] for l in transcript if l.get("speaker") != "subscriber"]
    scoring = risk.score_transcript(caller_lines, metadata)
    entities = dict(client_privacy.get("entities_removed", {}))
    for k, n in residual.items():
        entities[k] = entities.get(k, 0) + n

    inc_id, now = _new_id(), clock.now()
    incident = {
        "_id": inc_id, "title": title, "source": source, "threat_type": threat_type,
        "status": "DETECTED", "severity": scoring["severity"], "risk_score": scoring["score"],
        "signals": scoring["signals"], "metadata_factors": scoring["metadata_factors"],
        "sanitized_transcript": transcript, "interventions": interventions, "evidence_refs": evidence_refs,
        "privacy": {"entities_removed": entities, "total_removed": sum(entities.values()),
                    "edge_tokenized": bool(client_privacy.get("edge_tokenized")),
                    "server_residual": residual, "policy_version": client_privacy.get("policy_version")},
        "analysis": None, "simulated": True, "seeded": seeded, "sim_env": adapters.new_env(conditions if conditions is not None else (
            {"bureau_outage_first_attempt": True} if Config.SIMULATE_ADAPTER_FAILURE else {})),
        "agent_state": None, "agent_run_id": None,
        "created_at": now, "updated_at": now, "contained_at": None, "report_generated_at": None,
    }
    get_db().incidents.insert_one(incident)
    audit.append("incident.detected", f"{scoring['severity'].title()} incident opened from {source} "
                 f"(risk {scoring['score']})", incident_id=inc_id, actor="detection-engine",
                 data={"risk_score": scoring["score"], "signals": [s["key"] for s in scoring["signals"]]})
    if residual:
        audit.append("privacy.residual_tokenized", f"Server validator tokenized {sum(residual.values())} residual "
                     f"value(s) missed at the edge", incident_id=inc_id, actor="privacy-sieve", data=residual)
    else:
        audit.append("privacy.validated", f"Server validation passed: {incident['privacy']['total_removed']} "
                     f"sensitive values tokenized, 0 residual", incident_id=inc_id, actor="privacy-sieve",
                     data={"entities_removed": entities})
    return incident


def analyze(incident_id: str, force_demo: bool = False) -> dict:
    inc = get_incident(incident_id)
    audit.append("ai.analysis_requested", "Sanitized context sent to AI commander", incident_id=incident_id,
                 actor="orchestrator", data={"engine_configured": "nemotron" if Config.NVIDIA_API_KEY else "demo"})
    result = ai_commander.analyze(inc, force_demo=force_demo)
    d, pol = result["decision"], result["policy"]
    _set(incident_id, analysis=result, status="ANALYZED" if inc["status"] == "DETECTED" else inc["status"],
         severity=d["severity"])
    audit.append("ai.decision_validated", f"{result['engine'].title()} proposed {len(pol['accepted']) + len(pol['rejected'])} "
                 f"action(s); {len(pol['accepted'])} passed schema & allowlist", incident_id=incident_id,
                 actor=f"ai-commander:{result['engine']}", data={"model": result["model"], "accepted": pol["accepted"],
                                                                 "confidence": d["confidence"]})
    for rej in pol["rejected"]:
        audit.append("policy.action_rejected", f"Rejected {rej['action']}: {rej['reason']}", incident_id=incident_id,
                     actor="policy-engine", data={"action": rej["action"]})
    return get_incident(incident_id)


def _last_slot(incident_id: str) -> float:
    db, now = get_db(), clock.now_dt()
    latest = db.containment_actions.find_one({"incident_id": incident_id}, sort=[("scheduled_at", -1)])
    if not latest:
        return 0.4
    delta = (clock.parse(latest["scheduled_at"]) - now).total_seconds()
    return max(0.4, delta + Config.CONTAINMENT_STEP_SECONDS)


def _queue(incident_id: str, action: str, params: dict, *, priority: int, rationale: str, requested_by: str,
           offset: float) -> dict:
    db = get_db()
    seq = db.containment_actions.count_documents({"incident_id": incident_id}) + 1
    spec = policy.ACTIONS[action]
    doc = {"_id": f"{incident_id}-A{seq:02d}", "incident_id": incident_id, "sequence": seq, "action": action,
           "params": params, "label": policy.describe(action, params), "category": spec["category"],
           "target": spec["target"], "priority": priority, "rationale": rationale, "requested_by": requested_by,
           "status": "QUEUED", "attempts": 0, "scheduled_at": clock.plus(offset), "started_at": None,
           "completed_at": None, "result": None, "simulated": True}
    db.containment_actions.insert_one(doc)
    return doc


def contain(incident_id: str, *, approved: list[str] | None, operator: str, instant=False) -> dict:
    with _lock:
        inc = get_incident(incident_id)
        if not inc.get("analysis"):
            raise ApiError(409, "not_analyzed", "Run AI analysis before authorizing containment")
        if inc.get("containment_authorized_at"):
            raise ApiError(409, "already_authorized", "Containment plan was already authorized for this incident")
        proposals = inc["analysis"]["decision"]["actions"]
        if approved is not None:
            proposals = [p for i, p in enumerate(proposals) if str(i) in approved or p["action"] in approved]
        if not proposals:
            raise ApiError(422, "no_actions", "No approved actions to execute")
        offset = _last_slot(incident_id)
        for p in proposals:
            ok, reason = policy.validate_action(p["action"], p["params"])
            if not ok:  # re-check at execution time: policy is enforced twice
                audit.append("policy.action_rejected", reason, incident_id=incident_id, actor="policy-engine")
                continue
            _queue(incident_id, p["action"], p["params"], priority=p["priority"], rationale=p["rationale"],
                   requested_by="ai-commander", offset=offset)
            offset += Config.CONTAINMENT_STEP_SECONDS
        _set(incident_id, status="CONTAINING", containment_started_at=clock.now(), containment_authorized_at=clock.now())
        audit.append("containment.authorized", f"{operator} authorized {len(proposals)} containment action(s)",
                     incident_id=incident_id, actor=f"operator:{operator}", data={"actions": [p["action"] for p in proposals]})
    return advance(incident_id, instant=instant)


def add_manual_action(incident_id: str, action: str, params: dict, operator: str, instant=False) -> dict:
    ok, reason = policy.validate_action(action, params)
    if not ok:
        audit.append("policy.action_rejected", f"Manual {action} rejected: {reason}", incident_id=incident_id,
                     actor="policy-engine")
        raise ApiError(422, "policy_violation", reason)
    with _lock:
        get_incident(incident_id)
        doc = _queue(incident_id, action, params, priority=1, rationale="Manual emergency control invoked by operator.",
                     requested_by=f"operator:{operator}", offset=_last_slot(incident_id))
        _set(incident_id, status="CONTAINING")
        audit.append("containment.manual_action", f"{operator} queued manual {doc['label']}", incident_id=incident_id,
                     actor=f"operator:{operator}", data={"action": action, "params": params})
    return advance(incident_id, instant=instant)


def retry_action(incident_id: str, action_id: str, operator: str, instant=False) -> dict:
    with _lock:
        db = get_db()
        act = db.containment_actions.find_one({"_id": action_id, "incident_id": incident_id})
        if not act:
            raise ApiError(404, "action_not_found", f"Action {action_id} not found")
        if act["status"] != "FAILED":
            raise ApiError(409, "not_retryable", "Only failed actions can be retried")
        db.containment_actions.update_one({"_id": action_id}, {"$set": {
            "status": "QUEUED", "scheduled_at": clock.plus(0.5), "started_at": None, "completed_at": None}})
        _set(incident_id, status="CONTAINING")
        audit.append("containment.retry", f"{operator} retried {act['label']}", incident_id=incident_id,
                     actor=f"operator:{operator}", data={"action_id": action_id})
    return advance(incident_id, instant=instant)


def advance(incident_id: str, instant=False) -> dict:
    """Move scheduled actions forward to the current time and roll up incident status."""
    with _lock:
        db, now = get_db(), clock.now_dt()
        actions = list(db.containment_actions.find({"incident_id": incident_id}, sort=[("scheduled_at", 1)]))
        run_time = Config.CONTAINMENT_STEP_SECONDS * 0.85
        inc_doc = get_incident(incident_id)
        env = inc_doc.get("sim_env")
        for act in actions:
            if act["status"] in TERMINAL:
                continue
            start = clock.parse(act["scheduled_at"])
            if act["status"] == "QUEUED" and (instant or now >= start):
                act["status"], act["started_at"] = "EXECUTING", clock.now()
                db.containment_actions.update_one({"_id": act["_id"]}, {"$set": {
                    "status": "EXECUTING", "started_at": act["started_at"]}})
                audit.append("containment.executing", f"Executing {act['label']} via simulated {act['target']} adapter",
                             incident_id=incident_id, actor="orchestrator", data={"action_id": act["_id"]})
            if act["status"] == "EXECUTING" and (instant or (now - start).total_seconds() >= run_time):
                attempt = act["attempts"] + 1
                res = adapters.execute(act["action"], act["params"], incident_id, attempt, env)
                if env is not None:
                    db.incidents.update_one({"_id": incident_id}, {"$set": {"sim_env": env}})
                status = "SUCCEEDED" if res["ok"] else "FAILED"
                db.containment_actions.update_one({"_id": act["_id"]}, {"$set": {
                    "status": status, "attempts": attempt, "completed_at": clock.now(), "result": res}})
                act["status"] = status
                audit.append(f"containment.{status.lower()}", f"{act['label']}: {res['message']}",
                             incident_id=incident_id, actor=f"adapter:{act['category']}",
                             data={"action_id": act["_id"], "reference": res["reference"], "attempt": attempt})
        _rollup(incident_id, actions)
    return status_payload(incident_id)


def _rollup(incident_id: str, actions: list[dict]):
    inc = get_incident(incident_id)
    if inc.get("agent_state") == "RUNNING":
        return  # the Nemotron agent owns the incident status while it runs
    if not actions or inc["status"] not in {"CONTAINING", "ATTENTION_REQUIRED", "CONTAINED"}:
        return
    statuses = [a["status"] for a in actions]
    if all(s in TERMINAL for s in statuses):
        from .agent import unresolved_failures  # failures later fixed or compensated no longer block containment
        new = "ATTENTION_REQUIRED" if unresolved_failures(incident_id) else "CONTAINED"
        if new != inc["status"]:
            _set(incident_id, status=new, contained_at=clock.now() if new == "CONTAINED" else None)
            if new == "CONTAINED":
                audit.append("incident.contained", f"All {len(actions)} containment actions succeeded",
                             incident_id=incident_id, actor="orchestrator")
            else:
                failed = statuses.count("FAILED")
                audit.append("incident.attention_required", f"{failed} action(s) failed and need operator attention",
                             incident_id=incident_id, actor="orchestrator")


def actions_for(incident_id: str) -> list[dict]:
    return [clean(a) for a in get_db().containment_actions.find({"incident_id": incident_id}, sort=[("sequence", 1)])]


def status_payload(incident_id: str) -> dict:
    inc = clean(get_incident(incident_id))
    acts = actions_for(incident_id)
    done = sum(a["status"] == "SUCCEEDED" for a in acts)
    failed = sum(a["status"] == "FAILED" for a in acts)
    from . import agent
    return {"incident": inc, "actions": acts, "agent": agent.latest_for(incident_id),
            "progress": {"total": len(acts), "succeeded": done, "failed": failed,
                         "executing": sum(a["status"] == "EXECUTING" for a in acts),
                         "queued": sum(a["status"] == "QUEUED" for a in acts),
                         "percent": round(100 * done / len(acts)) if acts else 0}}


def list_incidents(limit=50) -> list[dict]:
    out = []
    for inc in get_db().incidents.find(sort=[("created_at", -1)]).limit(limit):
        acts = actions_for(inc["_id"])
        out.append({"id": inc["_id"], "title": inc["title"], "status": inc["status"], "severity": inc["severity"],
                    "risk_score": inc["risk_score"], "threat_type": inc["threat_type"], "source": inc["source"],
                    "created_at": inc["created_at"], "seeded": inc.get("seeded", False),
                    "actions_total": len(acts), "actions_succeeded": sum(a["status"] == "SUCCEEDED" for a in acts)})
    return out
