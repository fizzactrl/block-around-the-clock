"""Nemotron containment agent — a real multi-step tool-calling loop.

    sanitized incident ──► Nemotron ──tool_call──► policy.validate_action ──► simulated adapter
           ▲                                                                       │
           └────────────── tool result (ok / code / message) as observation ◄──────┘

The loop continues until Nemotron calls ``complete_containment`` or
``request_human_intervention``, or a server-side guard stops it. Every model
turn, tool call, observation, policy block and replan is persisted as a step
and audit-logged. There is NO mock fallback: if the NVIDIA API is unreachable
the run ends in ERROR and the UI says so.
"""
import json
import threading
import time
import uuid

import requests

from .. import clock
from ..config import Config
from ..db import clean, get_db
from ..errors import ApiError
from . import adapters, audit, policy
from .tokenizer import sanitize_tree

MAX_TURNS = 16
MAX_SAME_FAILURE = 2
AVAILABLE_MODELS = {
    "nvidia/nemotron-3.5-lightning-30b-a3b": "Nemotron 3.5 Lightning 30B-A3B",
    "nvidia/nemotron-3-ultra-550b-a55b": "Nemotron 3 Ultra 550B-A55B",
}

SYSTEM_PROMPT = """You are BATC-Agent, the autonomous incident-containment agent inside a telecom carrier's security gateway.
You receive SANITIZED incident data: personal data is replaced by tokens such as [PHONE_1A2B3C]. Never try to reconstruct tokens.

Operating procedure:
1. Your first call must be record_assessment (exactly once).
2. Then call ONE containment tool per turn. After each call you receive the adapter's authoritative result as JSON:
   {"ok": bool, "code": str, "message": str, "reference": str|null}.
3. If a tool fails, diagnose the error message before acting. Do not repeat an identical failing call unless the
   error says it is transient. Prefer a corrective action (fix the blocking condition, then retry) or an alternative
   action that achieves the same objective. The execution policy blocks repeated identical failures.
4. Be proportionate: take only actions justified by the evidence. Session revocation and credential resets are for
   disclosed codes or credentials; SIM / port-out controls are for SIM-swap or OTP-interception risk. Low-risk
   nuisance calls need minimal action.
   Identity policy: when an SSN is exposed, a security freeze is REQUIRED at each of the three bureaus (equifax,
   experian, transunion). A fraud alert is weaker and is only an acceptable fallback for a bureau where a freeze
   cannot be placed.
5. Finish with complete_containment once every objective is met or compensated, or request_human_intervention
   if an objective cannot be achieved with your tools.
Every tool argument named "rationale" must briefly explain why, referencing the evidence or the previous result.
Containment adapters are simulated in this demo environment, but treat their results as authoritative."""

_RATIONALE = {"type": "string", "description": "One or two sentences: why this action now, citing evidence or the last tool result."}

TOOL_DESCRIPTIONS = {
    "LOCK_SIM": "Lock SIM and eSIM profile changes (swap/reprovision) for the subscriber's line.",
    "BLOCK_PORT_OUT": "Freeze number port-out and cancel any in-flight port-out request for the line.",
    "ENABLE_CALL_SHIELD": "Screen unverified (STIR/SHAKEN attestation C) calls to the subscriber with a carrier security whisper.",
    "REVOKE_SESSIONS": "Revoke active sessions and refresh tokens at the identity provider for the given scope.",
    "RESET_CREDENTIALS": "Force a password reset and MFA re-enrollment at the identity provider.",
    "FREEZE_CREDIT": "Place a security freeze with one credit bureau (call once per bureau).",
    "PLACE_FRAUD_ALERT": "Place an initial fraud alert with one bureau. The bureau that receives it is required to notify the other two, "
                         "so a single alert covers all three bureaus. Lighter than a freeze, but useful as a fallback.",
    "ALERT_BANK_FRAUD": "Alert the subscriber's bank fraud desk and hold outbound wires / P2P transfers.",
}


def tool_schemas() -> list[dict]:
    tools = [{"type": "function", "function": {
        "name": "record_assessment",
        "description": "Record your initial assessment of the incident. Must be the first call.",
        "parameters": {"type": "object", "required": ["severity", "threat_summary", "objectives", "rationale"], "properties": {
            "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
            "threat_summary": {"type": "string"},
            "objectives": {"type": "array", "items": {"type": "string"}, "description": "Containment objectives, in priority order."},
            "rationale": _RATIONALE}}}}]
    for action, spec in policy.ACTIONS.items():
        props = {k: {"type": "string", "enum": v} for k, v in spec["params"].items()}
        props["rationale"] = _RATIONALE
        tools.append({"type": "function", "function": {
            "name": action.lower(), "description": TOOL_DESCRIPTIONS[action] + " [simulated adapter]",
            "parameters": {"type": "object", "properties": props, "required": [*spec["params"].keys(), "rationale"]}}})
    tools += [
        {"type": "function", "function": {
            "name": "request_human_intervention",
            "description": "Stop and escalate to a human operator when an objective cannot be achieved with available tools.",
            "parameters": {"type": "object", "required": ["reason", "blocking_issue"], "properties": {
                "reason": {"type": "string"}, "blocking_issue": {"type": "string"}}}}},
        {"type": "function", "function": {
            "name": "complete_containment",
            "description": "Declare containment complete. Call only when every objective is met or compensated.",
            "parameters": {"type": "object", "required": ["summary", "residual_risks"], "properties": {
                "summary": {"type": "string"},
                "residual_risks": {"type": "array", "items": {"type": "string"}}}}}},
    ]
    return tools


# ── Model client ────────────────────────────────────────────────────────────

def nemotron_chat(messages: list[dict], model: str) -> dict:
    """One Nemotron turn. Retries transient errors; never substitutes a fake response."""
    if not Config.NVIDIA_API_KEY:
        raise ApiError(503, "nemotron_not_configured", "NVIDIA_API_KEY is not configured")
    last_err = None
    for attempt in range(3):
        started = time.perf_counter()
        try:
            resp = requests.post(
                f"{Config.NVIDIA_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {Config.NVIDIA_API_KEY}", "Accept": "application/json"},
                json={"model": model, "messages": messages, "tools": tool_schemas(), "tool_choice": "auto",
                      "temperature": 0.2, "top_p": 0.95, "max_tokens": 2048},
                timeout=Config.NEMOTRON_TIMEOUT_SECONDS)
            if resp.status_code in (429, 500, 502, 503, 504):
                last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
                time.sleep(1.5 * (attempt + 1))
                continue
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            body = resp.json()
            return {"message": body["choices"][0]["message"], "usage": body.get("usage") or {},
                    "latency_ms": int((time.perf_counter() - started) * 1000), "model": body.get("model", model),
                    "response_id": body.get("id")}
        except requests.RequestException as exc:
            last_err = f"{type(exc).__name__}: {exc}"
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Nemotron API unavailable after 3 attempts ({last_err})")


# ── Run lifecycle ───────────────────────────────────────────────────────────

_threads: dict[str, threading.Thread] = {}


def incident_context(inc: dict) -> dict:
    ctx = {
        "incident_id": inc["_id"], "source": inc["source"], "title": inc["title"], "threat_type": inc.get("threat_type"),
        "risk_score": inc.get("risk_score"), "risk_engine_severity": inc.get("severity"),
        "signals": [s["label"] for s in inc.get("signals", [])],
        "carrier_metadata": [f["label"] for f in inc.get("metadata_factors", [])],
        "pii_categories_exposed_in_conversation": sorted(inc.get("privacy", {}).get("entities_removed", {}).keys()),
        "carrier_interventions_already_applied": inc.get("interventions", []),
        "sanitized_transcript": [f'{l["speaker"]}: {l["text"]}' for l in inc.get("sanitized_transcript", [])],
    }
    clean_ctx, _ = sanitize_tree(ctx)
    return clean_ctx


def start(incident_id: str, *, model: str | None = None, operator: str = "operator", mode: str = "live",
          llm=None, synchronous: bool = False) -> dict:
    db = get_db()
    inc = db.incidents.find_one({"_id": incident_id})
    if not inc:
        raise ApiError(404, "incident_not_found", f"Incident {incident_id} does not exist")
    if llm is None and not Config.NVIDIA_API_KEY:
        raise ApiError(503, "nemotron_not_configured",
                       "The Nemotron agent requires NVIDIA_API_KEY. No mock agent is substituted.")
    model = model or Config.NEMOTRON_MODEL
    if llm is None and model not in AVAILABLE_MODELS and model != Config.NEMOTRON_MODEL:
        raise ApiError(422, "unsupported_model", f"Model '{model}' is not enabled", {"available": list(AVAILABLE_MODELS)})
    running = db.agent_runs.find_one({"incident_id": incident_id, "status": "RUNNING"})
    if running:
        raise ApiError(409, "agent_running", "An agent run is already in progress for this incident")

    run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
    run = {"_id": run_id, "incident_id": incident_id, "model": model, "mode": mode, "status": "RUNNING",
           "operator": operator, "started_at": clock.now(), "finished_at": None, "steps": [], "turns": 0,
           "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, "model_latency_ms": 0,
           "outcome": None, "error": None, "engine": "nemotron" if llm is None else "test-double",
           "environment": adapters.describe_env(inc.get("sim_env"))}
    db.agent_runs.insert_one(run)
    db.incidents.update_one({"_id": incident_id}, {"$set": {
        "status": "CONTAINING", "agent_state": "RUNNING", "agent_run_id": run_id, "updated_at": clock.now()}})
    audit.append("agent.started", f"{operator} engaged Nemotron agent ({model.split('/')[-1]})", incident_id=incident_id,
                 actor=f"operator:{operator}", data={"run_id": run_id, "model": model, "mode": mode})

    if synchronous:
        _loop(run_id, llm or nemotron_chat)
    else:
        t = threading.Thread(target=_loop, args=(run_id, llm or nemotron_chat), daemon=True, name=run_id)
        _threads[run_id] = t
        t.start()
    return get_run(run_id)


def stop(run_id: str, operator: str) -> dict:
    db = get_db()
    run = db.agent_runs.find_one({"_id": run_id})
    if not run:
        raise ApiError(404, "run_not_found", f"Run {run_id} not found")
    if run["status"] == "RUNNING":
        db.agent_runs.update_one({"_id": run_id}, {"$set": {"stop_requested_by": operator}})
    return get_run(run_id)


def get_run(run_id: str) -> dict:
    return clean(get_db().agent_runs.find_one({"_id": run_id}))


def latest_for(incident_id: str) -> dict | None:
    return clean(get_db().agent_runs.find_one({"incident_id": incident_id}, sort=[("started_at", -1)]))


# ── The loop ────────────────────────────────────────────────────────────────

def _push(run_id: str, step: dict, **fields):
    db = get_db()
    run = db.agent_runs.find_one({"_id": run_id}, {"steps": 1})
    step = {"n": len(run["steps"]) + 1, "ts": clock.now(), **step}
    upd = {"$push": {"steps": step}}
    if fields:
        upd["$set"] = fields
    db.agent_runs.update_one({"_id": run_id}, upd)
    return step


def _finish(run_id: str, incident_id: str, status: str, outcome: dict | None = None, error: str | None = None):
    db = get_db()
    db.agent_runs.update_one({"_id": run_id}, {"$set": {"status": status, "finished_at": clock.now(),
                                                       "outcome": outcome, "error": error}})
    inc_status = {"COMPLETED": "CONTAINED", "HUMAN_REQUIRED": "ATTENTION_REQUIRED"}.get(status, "ATTENTION_REQUIRED")
    if status == "COMPLETED" and outcome and outcome.get("unresolved_failures"):
        inc_status = "ATTENTION_REQUIRED"
    db.incidents.update_one({"_id": incident_id}, {"$set": {
        "status": inc_status, "agent_state": status, "updated_at": clock.now(),
        "contained_at": clock.now() if inc_status == "CONTAINED" else None}})
    audit.append(f"agent.{status.lower()}", {
        "COMPLETED": "Agent declared containment complete" + (" — server guard found unresolved failures" if inc_status != "CONTAINED" else ""),
        "HUMAN_REQUIRED": "Agent requested human intervention",
        "STOPPED": "Agent stopped by operator",
        "ERROR": f"Agent run failed: {error}",
        "MAX_TURNS": "Agent hit the turn budget without finishing",
    }[status], incident_id=incident_id, actor="nemotron-agent", data={"run_id": run_id})


def unresolved_failures(incident_id: str) -> list[str]:
    acts = list(get_db().containment_actions.find({"incident_id": incident_id}, sort=[("sequence", 1)]))
    latest: dict[str, dict] = {}
    for a in acts:
        latest[adapters._key(a["action"], a["params"])] = a
    fraud_alert_ok = any(a["action"] == "PLACE_FRAUD_ALERT" and a["status"] == "SUCCEEDED" for a in acts)
    out = []
    for a in latest.values():
        if a["status"] != "FAILED":
            continue
        if a["action"] in ("FREEZE_CREDIT", "PLACE_FRAUD_ALERT") and fraud_alert_ok:
            continue  # compensated: a fraud alert propagates to every bureau
        out.append(a["label"])
    return out


def _execute_tool(run_id: str, inc: dict, name: str, args: dict, failures: dict) -> dict:
    """Validate and execute one containment tool call. Returns the observation sent back to the model."""
    db = get_db()
    incident_id = inc["_id"]
    action = name.upper()
    params = {k: v for k, v in args.items() if k != "rationale"}
    ok, reason = policy.validate_action(action, params)
    key = adapters._key(action, params)
    if ok and failures.get(key, 0) >= MAX_SAME_FAILURE:
        ok, reason = False, (f"{action} with these parameters already failed {failures[key]} times; repeating it is blocked. "
                             "Choose a corrective or alternative action, or request human intervention.")
    if not ok:
        audit.append("agent.policy_blocked", f"Policy blocked {name}: {reason}", incident_id=incident_id,
                     actor="policy-engine", data={"run_id": run_id})
        return {"ok": False, "code": "POLICY_BLOCKED", "message": reason, "reference": None, "blocked": True}

    seq = db.containment_actions.count_documents({"incident_id": incident_id}) + 1
    spec = policy.ACTIONS[action]
    prior = db.containment_actions.count_documents({"incident_id": incident_id, "action": action, "params": params})
    doc = {"_id": f"{incident_id}-A{seq:02d}", "incident_id": incident_id, "sequence": seq, "action": action,
           "params": params, "label": policy.describe(action, params), "category": spec["category"],
           "target": spec["target"], "priority": seq, "rationale": args.get("rationale", ""),
           "requested_by": "nemotron-agent", "run_id": run_id, "status": "EXECUTING", "attempts": prior + 1,
           "scheduled_at": clock.now(), "started_at": clock.now(), "completed_at": None, "result": None, "simulated": True}
    db.containment_actions.insert_one(doc)
    audit.append("containment.executing", f"Agent executing {doc['label']} via simulated {spec['target']} adapter",
                 incident_id=incident_id, actor="nemotron-agent", data={"action_id": doc["_id"], "run_id": run_id})
    time.sleep(0.35)  # brief, visible execution window in the UI

    env = inc.get("sim_env") or adapters.new_env()
    res = adapters.execute(action, params, incident_id, prior + 1, env)
    inc["sim_env"] = env
    db.incidents.update_one({"_id": incident_id}, {"$set": {"sim_env": env}})
    status = "SUCCEEDED" if res["ok"] else "FAILED"
    db.containment_actions.update_one({"_id": doc["_id"]}, {"$set": {
        "status": status, "completed_at": clock.now(), "result": res}})
    if not res["ok"]:
        failures[key] = failures.get(key, 0) + 1
    audit.append(f"containment.{status.lower()}", f"{doc['label']}: {res['message']}", incident_id=incident_id,
                 actor=f"adapter:{spec['category']}", data={"action_id": doc["_id"], "reference": res["reference"],
                                                           "code": res["code"], "run_id": run_id})
    return {**{k: res[k] for k in ("ok", "code", "message", "reference")}, "action_id": doc["_id"]}


def _loop(run_id: str, llm):
    db = get_db()
    run = db.agent_runs.find_one({"_id": run_id})
    incident_id, model = run["incident_id"], run["model"]
    inc = db.incidents.find_one({"_id": incident_id})
    context = incident_context(inc)
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": "New sanitized incident. Assess it, then contain it.\n" + json.dumps(context, indent=2)}]
    _push(run_id, {"kind": "context", "content": context})

    failures: dict[str, int] = {}
    assessed = False
    last_failed = False
    nudges = 0
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    latency = 0
    try:
        for turn in range(1, MAX_TURNS + 1):
            if db.agent_runs.find_one({"_id": run_id}).get("stop_requested_by"):
                return _finish(run_id, incident_id, "STOPPED")
            reply = llm(messages, model)
            msg = reply["message"]
            for k in usage:
                usage[k] += int(reply["usage"].get(k) or 0)
            latency += reply["latency_ms"]
            db.agent_runs.update_one({"_id": run_id}, {"$set": {"turns": turn, "usage": usage, "model_latency_ms": latency,
                                                               "served_model": reply.get("model")}})
            reasoning, _ = sanitize_tree((msg.get("reasoning_content") or msg.get("reasoning") or "").strip()[:1500])
            content, _ = sanitize_tree((msg.get("content") or "").strip()[:800])
            tool_calls = msg.get("tool_calls") or []
            _push(run_id, {"kind": "model_turn", "turn": turn, "reasoning": reasoning, "content": content,
                           "latency_ms": reply["latency_ms"], "tokens": reply["usage"].get("total_tokens"),
                           "tool_calls": [tc["function"]["name"] for tc in tool_calls], "response_id": reply.get("response_id")})

            if not tool_calls:
                nudges += 1
                if nudges > 2:
                    return _finish(run_id, incident_id, "ERROR", error="Model stopped calling tools")
                messages.append({"role": "assistant", "content": msg.get("content") or ""})
                messages.append({"role": "user", "content": "Respond by calling exactly one tool."})
                continue

            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": [
                {"id": tc["id"], "type": "function", "function": {"name": tc["function"]["name"],
                                                                  "arguments": tc["function"].get("arguments") or "{}"}}
                for tc in tool_calls]})

            for tc in tool_calls:
                name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("arguments must be an object")
                except Exception as exc:
                    obs = {"ok": False, "code": "INVALID_ARGUMENTS", "message": f"Could not parse arguments: {exc}"}
                    _push(run_id, {"kind": "tool_call", "tool": name, "args": {}, "call_id": tc["id"]})
                    _push(run_id, {"kind": "observation", "tool": name, "result": obs, "call_id": tc["id"]})
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(obs)})
                    continue
                args, _ = sanitize_tree(args)

                if name == "record_assessment":
                    assessed = True
                    _push(run_id, {"kind": "assessment", "args": args, "call_id": tc["id"]})
                    db.incidents.update_one({"_id": incident_id}, {"$set": {"agent_assessment": args}})
                    audit.append("agent.assessment", f"Nemotron assessed incident as {args.get('severity', '?')}: "
                                 f"{str(args.get('threat_summary', ''))[:140]}", incident_id=incident_id, actor="nemotron-agent",
                                 data={"run_id": run_id, "objectives": args.get("objectives", [])[:6]})
                    obs = {"ok": True, "code": "ASSESSMENT_RECORDED", "message": "Assessment recorded. Proceed with containment."}
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(obs)})
                    continue

                if name == "complete_containment":
                    open_fail = unresolved_failures(incident_id)
                    _push(run_id, {"kind": "final", "tool": name, "args": args, "call_id": tc["id"]})
                    return _finish(run_id, incident_id, "COMPLETED", outcome={
                        "summary": args.get("summary"), "residual_risks": args.get("residual_risks", []),
                        "unresolved_failures": open_fail})

                if name == "request_human_intervention":
                    _push(run_id, {"kind": "escalation", "tool": name, "args": args, "call_id": tc["id"]})
                    return _finish(run_id, incident_id, "HUMAN_REQUIRED", outcome={
                        "reason": args.get("reason"), "blocking_issue": args.get("blocking_issue"),
                        "unresolved_failures": unresolved_failures(incident_id)})

                if not assessed:
                    obs = {"ok": False, "code": "ASSESSMENT_REQUIRED", "message": "Call record_assessment first."}
                    _push(run_id, {"kind": "tool_call", "tool": name, "args": args, "call_id": tc["id"], "replan": False})
                    _push(run_id, {"kind": "observation", "tool": name, "result": obs, "call_id": tc["id"]})
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(obs)})
                    continue

                _push(run_id, {"kind": "tool_call", "tool": name, "args": args, "call_id": tc["id"], "replan": last_failed})
                if last_failed:
                    audit.append("agent.replan", f"Nemotron replanned after failure → {name}", incident_id=incident_id,
                                 actor="nemotron-agent", data={"run_id": run_id, "rationale": str(args.get("rationale", ""))[:200]})
                inc = db.incidents.find_one({"_id": incident_id})
                obs = _execute_tool(run_id, inc, name, args, failures)
                last_failed = not obs["ok"]
                _push(run_id, {"kind": "observation", "tool": name, "result": obs, "call_id": tc["id"]})
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(
                    {k: obs.get(k) for k in ("ok", "code", "message", "reference")})})
        return _finish(run_id, incident_id, "MAX_TURNS", outcome={"unresolved_failures": unresolved_failures(incident_id)})
    except Exception as exc:  # surfaced to the UI — never replaced with a mock
        return _finish(run_id, incident_id, "ERROR", error=f"{type(exc).__name__}: {str(exc)[:300]}")
