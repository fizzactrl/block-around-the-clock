"""Agent-loop mechanics, tested with a scripted model stand-in (TEST ONLY — the
runtime never substitutes a mock; without NVIDIA_API_KEY the agent refuses to run).
The stand-in asserts that every adapter result is fed back to the model before
its next decision, which is the core of the agentic loop."""
import json

from app.services import agent, audit, evaluation, orchestrator
from app.services.adapters import new_env


class ScriptedModel:
    def __init__(self, script):
        self.script = list(script)
        self.seen_results = []

    def __call__(self, messages, model):
        if messages[-1]["role"] == "tool":
            self.seen_results.append(json.loads(messages[-1]["content"]))
        name, args = self.script.pop(0)
        return {"message": {"content": "", "reasoning_content": f"Deciding on {name}",
                            "tool_calls": [{"id": f"call-{len(self.script)}", "type": "function",
                                            "function": {"name": name, "arguments": json.dumps(args)}}]},
                "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}, "latency_ms": 5, "model": model}


def _incident(conditions):
    inc = orchestrator.create_incident(
        source="call", title="Test incident", threat_type="Vishing", metadata={"attestation": "C"},
        transcript=[{"speaker": "caller", "text": "Read me the code [OTP_ABC123] and your social security number [SSN_ABC123]"}],
        client_privacy={"entities_removed": {"OTP": 1, "SSN": 1}}, interventions=[], evidence_refs=[], conditions=conditions)
    return inc["_id"]


ASSESS = ("record_assessment", {"severity": "critical", "threat_summary": "OTP and SSN phished", "objectives": ["lock"],
                                "rationale": "evidence"})


def test_agent_refuses_without_key(client):
    iid = _incident({})
    r = client.post(f"/api/incidents/{iid}/agent", json={})
    assert r.status_code == 503 and r.get_json()["error"]["code"] == "nemotron_not_configured"


def test_agent_replans_after_dependent_failure(client):
    iid = _incident({"port_out_pending": True})
    m = ScriptedModel([ASSESS, ("lock_sim", {"rationale": "stop swap"}), ("block_port_out", {"rationale": "port in flight"}),
                       ("lock_sim", {"rationale": "retry after fix"}), ("complete_containment", {"summary": "done", "residual_risks": []})])
    run = agent.start(iid, llm=m, synchronous=True)
    run = agent.get_run(run["id"])
    assert run["status"] == "COMPLETED"
    # observations were fed back: the model saw the failure before choosing block_port_out
    codes = [r["code"] for r in m.seen_results]
    assert codes[:4] == ["ASSESSMENT_RECORDED", "PORT_OUT_IN_PROGRESS", "PORT_FROZEN", "LOCKED"]
    calls = [s for s in run["steps"] if s["kind"] == "tool_call"]
    assert [c["replan"] for c in calls] == [False, True, False]
    st = orchestrator.status_payload(iid)
    assert st["incident"]["status"] == "CONTAINED"
    assert [a["status"] for a in st["actions"]] == ["FAILED", "SUCCEEDED", "SUCCEEDED"]
    assert "agent.replan" in [e["event_type"] for e in audit.for_incident(iid)]
    assert audit.verify()["valid"]


def test_agent_policy_blocks_loops_and_server_guards_completion(client):
    iid = _incident({"bureau_outage": ["transunion"]})
    tu = ("freeze_credit", {"bureau": "transunion", "rationale": "ssn"})
    m = ScriptedModel([ASSESS, tu, tu, tu, ("wire_money", {"rationale": "x"}),
                       ("complete_containment", {"summary": "done", "residual_risks": []})])
    run = agent.get_run(agent.start(iid, llm=m, synchronous=True)["id"])
    codes = [r["code"] for r in m.seen_results]
    assert codes[1:5] == ["BUREAU_UNAVAILABLE", "BUREAU_UNAVAILABLE", "POLICY_BLOCKED", "POLICY_BLOCKED"]
    assert run["outcome"]["unresolved_failures"] == ["Credit freeze · TransUnion"]
    assert orchestrator.get_incident(iid)["status"] == "ATTENTION_REQUIRED"  # agent said done; server disagrees


def test_fraud_alert_compensates_outage(client):
    iid = _incident({"bureau_outage": ["transunion"]})
    m = ScriptedModel([ASSESS, ("freeze_credit", {"bureau": "transunion", "rationale": "ssn"}),
                       ("place_fraud_alert", {"bureau": "equifax", "rationale": "outage fallback"}),
                       ("complete_containment", {"summary": "done", "residual_risks": ["TU freeze pending"]})])
    agent.start(iid, llm=m, synchronous=True)
    assert orchestrator.get_incident(iid)["status"] == "CONTAINED"
    rep = client.get(f"/api/legal-report/{iid}").get_json()["data"]
    assert rep["agent_trace"]["steps"] and rep["agent_trace"]["model"]


def test_evaluation_grades_replanning(client):
    m = ScriptedModel([ASSESS, ("lock_sim", {"rationale": "a"}), ("block_port_out", {"rationale": "b"}),
                       ("lock_sim", {"rationale": "c"}), ("complete_containment", {"summary": "d", "residual_risks": []})])
    ev = evaluation.run("port-out-dependency", None, llm=m, synchronous=True)
    assert ev["grade"]["verdict"] == "PASS", ev["grade"]


def test_adapter_env_is_stateful():
    from app.services.adapters import execute
    env = new_env({"port_out_pending": True})
    assert execute("LOCK_SIM", {}, "X", 1, env)["code"] == "PORT_OUT_IN_PROGRESS"
    assert execute("BLOCK_PORT_OUT", {}, "X", 1, env)["ok"]
    assert execute("LOCK_SIM", {}, "X", 2, env)["ok"]
    assert execute("LOCK_SIM", {}, "X", 3, env)["code"] == "NO_OP"
