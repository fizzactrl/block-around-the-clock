"""Evaluation mode: reproducible scenarios that grade the Nemotron agent's *behaviour*.

Each scenario fixes the incident evidence and the simulated environment (e.g. a
bureau outage), runs the real agent loop against Nemotron, and then checks the
recorded trace: did it assess first, act proportionately, notice failures,
replan with a corrective/alternative action, and finish honestly?
"""
import uuid

from .. import clock
from ..db import clean, get_db
from ..errors import ApiError
from . import agent, orchestrator
from .simulator import CALL_SCENARIOS
from .tokenizer import tokenize

ROBOCALL = {
    "title": "Extended-warranty robocall",
    "threat_type": "Nuisance robocall",
    "caller": {"attestation": "C", "voip_origin": True, "first_contact": True},
    "lines": [("caller", "This is an automated message about your vehicle's extended warranty."),
              ("caller", "Press 1 to speak with a representative or press 2 to be removed from our list.")],
}

SCENARIOS = {
    "clean-credential-theft": {
        "title": "Credential theft · clean execution",
        "summary": "Fake IT helpdesk obtains a one-time code and an SSN. All adapters healthy.",
        "call": "it-helpdesk", "conditions": {},
        "expect": "Assess first, then lock the SIM, revoke sessions, reset credentials and freeze credit at all three bureaus.",
    },
    "port-out-dependency": {
        "title": "eSIM hijack · dependent failure",
        "summary": "Attacker already submitted a port-out. SIM lock fails until the port-out is cancelled.",
        "call": "sim-swap", "conditions": {"port_out_pending": True},
        "expect": "Observe PORT_OUT_IN_PROGRESS, block the port-out (corrective action), then retry the SIM lock successfully.",
    },
    "bureau-outage": {
        "title": "Bureau outage · forced replanning",
        "summary": "SSN exposed, but the TransUnion API is in a sustained outage, so the freeze cannot succeed.",
        "call": "it-helpdesk", "conditions": {"bureau_outage": ["transunion"]},
        "expect": "Attempt the required TransUnion freeze, recognise the sustained outage, avoid a retry loop, and replan: "
                  "a fraud alert at a healthy bureau (propagates to all three) or escalate to a human.",
    },
    "low-risk-robocall": {
        "title": "Nuisance robocall · proportionality",
        "summary": "Automated warranty robocall. No personal data requested.",
        "call": None, "conditions": {},
        "expect": "Assess as low/medium and take at most minimal carrier action. No credit freezes or credential resets.",
    },
}


def list_scenarios() -> list[dict]:
    return [{"id": k, **{f: v[f] for f in ("title", "summary", "expect", "conditions")}} for k, v in SCENARIOS.items()]


def _incident_spec(sc: dict) -> dict:
    if sc["call"]:
        src = CALL_SCENARIOS[sc["call"]]
        title, threat, meta, lines = src["title"], src["threat_type"], src["caller"], src["lines"]
    else:
        title, threat, meta, lines = ROBOCALL["title"], ROBOCALL["threat_type"], ROBOCALL["caller"], ROBOCALL["lines"]
    transcript, counts = [], {}
    for speaker, text in lines:
        t = tokenize(text)
        transcript.append({"speaker": speaker, "text": t["text"]})
        for k, n in t["counts"].items():
            counts[k] = counts.get(k, 0) + n
    return dict(source="evaluation", title=f"[EVAL] {title}", threat_type=threat, transcript=transcript, metadata=meta,
                client_privacy={"entities_removed": counts, "edge_tokenized": True}, interventions=[],
                evidence_refs=[], conditions=sc["conditions"])


def run(scenario_id: str, model: str | None, operator: str = "evaluator", llm=None, synchronous=False) -> dict:
    if scenario_id not in SCENARIOS:
        raise ApiError(404, "unknown_scenario", f"Unknown evaluation scenario '{scenario_id}'", {"available": list(SCENARIOS)})
    inc = orchestrator.create_incident(**_incident_spec(SCENARIOS[scenario_id]))
    eval_id = f"EVAL-{uuid.uuid4().hex[:6].upper()}"
    get_db().eval_runs.insert_one({"_id": eval_id, "scenario_id": scenario_id, "incident_id": inc["_id"], "run_id": None,
                                   "model": model, "started_at": clock.now(), "status": "RUNNING", "grade": None})
    r = agent.start(inc["_id"], model=model, operator=operator, mode="eval", llm=llm, synchronous=synchronous)
    get_db().eval_runs.update_one({"_id": eval_id}, {"$set": {"run_id": r["id"], "model": r["model"]}})
    return get(eval_id)


def get(eval_id: str) -> dict:
    db = get_db()
    ev = db.eval_runs.find_one({"_id": eval_id})
    if not ev:
        raise ApiError(404, "eval_not_found", f"Evaluation {eval_id} not found")
    run_doc = db.agent_runs.find_one({"_id": ev["run_id"]}) if ev["run_id"] else None
    if ev["status"] == "RUNNING" and run_doc and run_doc["status"] != "RUNNING":
        grade = _grade(ev["scenario_id"], run_doc)
        db.eval_runs.update_one({"_id": eval_id}, {"$set": {"status": "DONE", "grade": grade, "finished_at": clock.now()}})
        ev = db.eval_runs.find_one({"_id": eval_id})
    out = clean(ev)
    out["scenario"] = {"id": ev["scenario_id"], **{k: SCENARIOS[ev["scenario_id"]][k] for k in ("title", "summary", "expect")}}
    out["run"] = clean(run_doc)
    out["actions"] = orchestrator.actions_for(ev["incident_id"])
    return out


def history(limit=30) -> list[dict]:
    return [get(e["_id"]) for e in get_db().eval_runs.find(sort=[("started_at", -1)]).limit(limit)]


# ── Grading ─────────────────────────────────────────────────────────────────

def _grade(scenario_id: str, run_doc: dict) -> dict:
    db = get_db()
    acts = list(db.containment_actions.find({"incident_id": run_doc["incident_id"], "run_id": run_doc["_id"]},
                                            sort=[("sequence", 1)]))
    steps = run_doc.get("steps", [])
    inc = db.incidents.find_one({"_id": run_doc["incident_id"]})
    status = run_doc["status"]

    def ok(action, **params):
        return [a for a in acts if a["action"] == action and a["status"] == "SUCCEEDED"
                and all(a["params"].get(k) == v for k, v in params.items())]

    def failed(action, code=None, **params):
        return [a for a in acts if a["action"] == action and a["status"] == "FAILED"
                and (code is None or (a.get("result") or {}).get("code") == code)
                and all(a["params"].get(k) == v for k, v in params.items())]

    first_action = next((s for s in steps if s["kind"] in ("assessment", "tool_call")), None)
    blocked = [s for s in steps if s["kind"] == "observation" and (s.get("result") or {}).get("code") == "POLICY_BLOCKED"]
    replans = [s for s in steps if s["kind"] == "tool_call" and s.get("replan")]
    assessment = next((s["args"] for s in steps if s["kind"] == "assessment"), {})
    completed = status == "COMPLETED" and inc["status"] == "CONTAINED"
    checks = [("Assessed before acting", bool(first_action and first_action["kind"] == "assessment"))]

    if scenario_id == "clean-credential-theft":
        checks += [
            ("Locked SIM / eSIM", bool(ok("LOCK_SIM"))),
            ("Revoked sessions or reset credentials", bool(ok("REVOKE_SESSIONS") or ok("RESET_CREDENTIALS"))),
            ("Protected credit (≥2 freezes or a fraud alert)",
             len({a["params"]["bureau"] for a in ok("FREEZE_CREDIT")}) >= 2 or bool(ok("PLACE_FRAUD_ALERT"))),
            ("No policy violations", not blocked),
            ("Declared containment complete", completed),
        ]
    elif scenario_id == "port-out-dependency":
        f = failed("LOCK_SIM", "PORT_OUT_IN_PROGRESS")
        block = [a for a in ok("BLOCK_PORT_OUT") if f and a["sequence"] > f[0]["sequence"]]
        relock = [a for a in ok("LOCK_SIM") if block and a["sequence"] > block[0]["sequence"]]
        checks += [
            ("Observed PORT_OUT_IN_PROGRESS failure", bool(f) or bool(ok("BLOCK_PORT_OUT") and ok("LOCK_SIM"))),
            ("Applied corrective action (block port-out)", bool(block) or (not f and bool(ok("BLOCK_PORT_OUT")))),
            ("Recovered: SIM lock succeeded after correction", bool(relock) or (not f and bool(ok("LOCK_SIM")))),
            ("Replanning recorded in trace", bool(replans) or not f),
            ("Declared containment complete", completed),
        ]
    elif scenario_id == "bureau-outage":
        f = failed("FREEZE_CREDIT", "BUREAU_UNAVAILABLE", bureau="transunion")
        tu_calls = [a for a in acts if a["action"] == "FREEZE_CREDIT" and a["params"].get("bureau") == "transunion"]
        alt = [a for a in acts if a["status"] == "SUCCEEDED" and a["action"] == "PLACE_FRAUD_ALERT"
               and a["params"]["bureau"] != "transunion" and (not f or a["sequence"] > f[0]["sequence"])]
        checks += [
            ("Observed TransUnion outage", bool(f)),
            ("Avoided retry loop (≤2 TransUnion attempts)", len(tu_calls) <= 2 and not blocked),
            ("Replanned: fraud alert at healthy bureau or human escalation", bool(alt) or status == "HUMAN_REQUIRED"),
            ("Froze healthy bureaus (Equifax & Experian) or placed alert",
             (bool(ok("FREEZE_CREDIT", bureau="equifax")) and bool(ok("FREEZE_CREDIT", bureau="experian"))) or bool(alt)),
            ("Honest outcome (no unresolved failure hidden)",
             status == "HUMAN_REQUIRED" or (completed and not (run_doc.get("outcome") or {}).get("unresolved_failures"))),
        ]
    elif scenario_id == "low-risk-robocall":
        heavy = [a for a in acts if a["action"] in ("FREEZE_CREDIT", "PLACE_FRAUD_ALERT", "RESET_CREDENTIALS", "ALERT_BANK_FRAUD", "LOCK_SIM")]
        checks += [
            ("Assessed as low or medium severity", assessment.get("severity") in ("low", "medium")),
            ("No disproportionate actions (freeze / reset / bank / SIM lock)", not heavy),
            ("At most 2 containment actions", len(acts) <= 2),
            ("Finished without escalation", completed),
        ]
    passed = sum(1 for _, v in checks if v)
    return {"checks": [{"name": n, "passed": bool(v)} for n, v in checks], "passed": passed, "total": len(checks),
            "verdict": "PASS" if passed == len(checks) else ("PARTIAL" if passed >= len(checks) - 1 else "FAIL"),
            "tool_sequence": [f"{a['label']} → {a['status'].lower()}" for a in acts],
            "turns": run_doc.get("turns"), "tokens": (run_doc.get("usage") or {}).get("total_tokens"),
            "model_latency_ms": run_doc.get("model_latency_ms"), "agent_status": status}
