"""REST API. All responses use the envelope {ok, data} or {ok:false, error:{code,message,details}}."""
from typing import Literal

from flask import Blueprint, Response, jsonify, request
from pydantic import BaseModel, Field, ValidationError

from . import clock
from .config import Config
from .db import get_db, mode
from .errors import ApiError
from .services import agent, audit, dashboard, evaluation, orchestrator, policy, reports, telemetry
from .services.simulator import CALL_SCENARIOS, build_call, list_scenarios
from .services.tokenizer import policy as privacy_policy
from .services.tokenizer import scan, tokenize

bp = Blueprint("api", __name__, url_prefix="/api")


def ok(data, status=200):
    return jsonify({"ok": True, "data": data}), status


def body(model: type[BaseModel]):
    try:
        return model.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        raise ApiError(422, "validation_error", "Request body failed validation",
                       [{"field": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in exc.errors()])


def instant() -> bool:
    return request.args.get("instant", "").lower() in {"1", "true"}


# ── Request schemas ─────────────────────────────────────────────────────────

class SimulateCallIn(BaseModel):
    scenario_id: str = "it-helpdesk"


class TokenizeIn(BaseModel):
    text: str = Field(max_length=20000)
    client_tokenized: bool = False


class TranscriptLine(BaseModel):
    speaker: str = Field(max_length=24)
    text: str = Field(max_length=2000)


class TriggerIn(BaseModel):
    source: Literal["call", "telemetry", "manual"] = "call"
    scenario_id: str | None = None
    title: str = Field(min_length=3, max_length=160)
    threat_type: str = Field(min_length=3, max_length=160)
    sanitized_transcript: list[TranscriptLine] = Field(default_factory=list, max_length=60)
    entities_removed: dict[str, int] = Field(default_factory=dict)
    interventions: list[str] = Field(default_factory=list, max_length=10)
    evidence_refs: list[str] = Field(default_factory=list, max_length=20)
    policy_version: str | None = None
    edge_tokenized: bool = True


class AnalyzeIn(BaseModel):
    incident_id: str


class ContainIn(BaseModel):
    approved: list[str] | None = None
    operator: str = Field(default="operator", max_length=40)


class ManualActionIn(BaseModel):
    action: str
    params: dict = Field(default_factory=dict)
    operator: str = Field(default="operator", max_length=40)


class TelemetryIn(BaseModel):
    count: int = Field(default=1, ge=1, le=20)


# ── Endpoints ───────────────────────────────────────────────────────────────

@bp.get("/health")
def health():
    get_db().command("ping") if mode() == "mongodb" else None
    return ok({"status": "ok", "time": clock.now(), "database": mode(),
               "ai_engine": "nemotron" if Config.NVIDIA_API_KEY else "demo",
               "agent": {"enabled": bool(Config.NVIDIA_API_KEY), "default_model": Config.NEMOTRON_MODEL,
                         "models": agent.AVAILABLE_MODELS},
               "model": Config.NEMOTRON_MODEL if Config.NVIDIA_API_KEY else "deterministic-rules-v1",
               "simulation": {"carrier": True, "containment_adapters": True},
               "privacy_policy_version": privacy_policy()["version"]})


@bp.get("/dashboard")
def get_dashboard():
    return ok(dashboard.build())


@bp.get("/scenarios")
def scenarios():
    return ok(list_scenarios())


@bp.post("/simulate-call")
def simulate_call():
    data = body(SimulateCallIn)
    if data.scenario_id not in CALL_SCENARIOS:
        raise ApiError(404, "unknown_scenario", f"Unknown scenario '{data.scenario_id}'",
                       {"available": list(CALL_SCENARIOS)})
    call = build_call(data.scenario_id)
    db = get_db()
    seq = db.sanitized_events.count_documents({"kind": "call"}) + 1
    event_id = f"CALL-{seq:05d}"
    # Persist ONLY the sanitized form.
    db.sanitized_events.insert_one({
        "_id": event_id, "kind": "call", "scenario_id": data.scenario_id, "caller_token": call["caller"]["number_token"],
        "attestation": call["caller"]["attestation"], "risk_score": call["final_risk"], "severity": call["severity"],
        "sanitized_lines": [{"speaker": l["speaker"], "text": l["sanitized_text"]} for l in call["lines"]],
        "simulated": True, "created_at": clock.now()})
    audit.append("call.simulated", f"Inbound call simulated: {call['title']} (attestation {call['caller']['attestation']})",
                 actor="carrier-simulator", data={"event_id": event_id})
    return ok({**call, "event_id": event_id})


@bp.post("/tokenize")
def tokenize_endpoint():
    """Server-side validation of edge-tokenized text (defense in depth)."""
    data = body(TokenizeIn)
    result = tokenize(data.text)
    residual = result["total"]
    if data.client_tokenized and residual:
        audit.append("privacy.residual_detected", f"Server found {residual} residual value(s) in edge-tokenized payload",
                     actor="privacy-sieve", data=result["counts"])
    return ok({"tokenized_text": result["text"],
               "entities": [{k: e[k] for k in ("type", "label", "start", "end", "token")} for e in result["entities"]],
               "counts": result["counts"], "residual_pii": residual,
               "verdict": "clean" if residual == 0 else ("residual_tokenized" if data.client_tokenized else "tokenized"),
               "policy_version": privacy_policy()["version"]})


@bp.get("/privacy/policy")
def get_privacy_policy():
    return ok(privacy_policy())


@bp.post("/trigger-incident")
def trigger_incident():
    data = body(TriggerIn)
    meta = CALL_SCENARIOS[data.scenario_id]["caller"] if data.scenario_id in CALL_SCENARIOS else {}
    if data.scenario_id in CALL_SCENARIOS:
        conditions = CALL_SCENARIOS[data.scenario_id].get("environment", {})
    elif data.scenario_id in {"telemetry:SIM_SWAP_REQUEST", "telemetry:PORT_OUT_REQUEST"}:
        conditions = {"port_out_pending": True}
    else:
        conditions = None  # default simulated environment
    inc = orchestrator.create_incident(
        source=data.source, title=data.title, threat_type=data.threat_type,
        transcript=[l.model_dump() for l in data.sanitized_transcript], metadata=meta,
        client_privacy={"entities_removed": data.entities_removed, "edge_tokenized": data.edge_tokenized,
                        "policy_version": data.policy_version},
        interventions=data.interventions, evidence_refs=data.evidence_refs, conditions=conditions)
    return ok(orchestrator.status_payload(inc["_id"]), 201)


@bp.post("/analyze-threat")
def analyze_threat():
    data = body(AnalyzeIn)
    orchestrator.analyze(data.incident_id)
    return ok(orchestrator.status_payload(data.incident_id))


@bp.get("/incidents")
def incidents():
    return ok(orchestrator.list_incidents())


@bp.get("/incident-status/<incident_id>")
def incident_status(incident_id):
    return ok(orchestrator.advance(incident_id, instant=instant()))


@bp.post("/incidents/<incident_id>/contain")
def contain(incident_id):
    data = body(ContainIn)
    return ok(orchestrator.contain(incident_id, approved=data.approved, operator=data.operator, instant=instant()), 202)


@bp.post("/incidents/<incident_id>/actions")
def manual_action(incident_id):
    data = body(ManualActionIn)
    return ok(orchestrator.add_manual_action(incident_id, data.action, data.params, data.operator, instant=instant()), 202)


@bp.post("/incidents/<incident_id>/actions/<action_id>/retry")
def retry(incident_id, action_id):
    operator = (request.get_json(silent=True) or {}).get("operator", "operator")[:40]
    return ok(orchestrator.retry_action(incident_id, action_id, operator, instant=instant()), 202)


@bp.get("/incidents/<incident_id>/timeline")
def timeline(incident_id):
    orchestrator.get_incident(incident_id)
    return ok({"incident_id": incident_id, "events": audit.for_incident(incident_id)})


@bp.get("/legal-report/<incident_id>")
def legal_report(incident_id):
    return ok(reports.build(incident_id))


@bp.get("/legal-report/<incident_id>/pdf")
def legal_report_pdf(incident_id):
    pdf = reports.pdf(incident_id)
    return Response(pdf, mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="incident-report-{incident_id}.pdf"'})


@bp.get("/telemetry/events")
def telemetry_events():
    limit = min(int(request.args.get("limit", 60)), 200)
    return ok({"events": telemetry.recent(limit), "summary": telemetry.summary()})


@bp.post("/telemetry/simulate")
def telemetry_simulate():
    data = body(TelemetryIn)
    return ok({"events": telemetry.ingest(data.count), "summary": telemetry.summary()}, 201)


@bp.get("/audit/verify")
def audit_verify():
    return ok(audit.verify())


@bp.get("/policy/actions")
def policy_actions():
    return ok([{"action": k, **v} for k, v in policy.ACTIONS.items()])


# ── Nemotron agent ──────────────────────────────────────────────────────────

class AgentStartIn(BaseModel):
    model: str | None = None
    operator: str = Field(default="operator", max_length=40)


class EvalRunIn(BaseModel):
    scenario_id: str
    model: str | None = None


@bp.get("/agent/models")
def agent_models():
    return ok({"default": Config.NEMOTRON_MODEL, "models": [{"id": k, "label": v} for k, v in agent.AVAILABLE_MODELS.items()],
               "enabled": bool(Config.NVIDIA_API_KEY), "tools": [t["function"]["name"] for t in agent.tool_schemas()]})


@bp.post("/incidents/<incident_id>/agent")
def agent_start(incident_id):
    data = body(AgentStartIn)
    return ok(agent.start(incident_id, model=data.model, operator=data.operator), 202)


@bp.get("/incidents/<incident_id>/agent")
def agent_latest(incident_id):
    orchestrator.get_incident(incident_id)
    return ok(agent.latest_for(incident_id))


@bp.get("/agent-runs/<run_id>")
def agent_run(run_id):
    run = agent.get_run(run_id)
    if not run:
        raise ApiError(404, "run_not_found", f"Run {run_id} not found")
    return ok(run)


@bp.post("/agent-runs/<run_id>/stop")
def agent_stop(run_id):
    operator = (request.get_json(silent=True) or {}).get("operator", "operator")[:40]
    return ok(agent.stop(run_id, operator))


@bp.get("/eval/scenarios")
def eval_scenarios():
    return ok(evaluation.list_scenarios())


@bp.post("/eval/run")
def eval_run():
    data = body(EvalRunIn)
    return ok(evaluation.run(data.scenario_id, data.model), 202)


@bp.get("/eval/runs")
def eval_runs():
    return ok(evaluation.history())


@bp.get("/eval/runs/<eval_id>")
def eval_get(eval_id):
    return ok(evaluation.get(eval_id))
