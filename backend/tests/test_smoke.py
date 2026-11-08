"""End-to-end smoke tests covering the full hackathon demo journey."""
import re

from app.services import audit, policy
from app.services.tokenizer import tokenize

RAW_PII = re.compile(r"\b\d{3}-\d{2}-\d{4}\b|\b\d{3}-\d{3}-\d{4}\b|482913|Maya Chen")


def data(resp, status=200):
    assert resp.status_code == status, resp.get_json()
    body = resp.get_json()
    assert body["ok"] is True
    return body["data"]


def test_health(client):
    d = data(client.get("/api/health"))
    assert d["status"] == "ok" and d["ai_engine"] == "demo"


def test_dashboard_seeded(client):
    d = data(client.get("/api/dashboard"))
    assert d["metrics"]["incidents_contained"] >= 3
    assert len(d["threat_timeline"]) == 24
    assert d["audit_chain"]["valid"] is True


def test_tokenizer_removes_all_categories():
    r = tokenize("Maya Chen at Wells Fargo, 415-555-0198, SSN 512-44-8890, code 482913, account 99887766")
    assert set(r["counts"]) >= {"PERSON", "BANK", "PHONE", "SSN", "OTP", "ACCOUNT"}
    assert not RAW_PII.search(r["text"])
    assert tokenize(r["text"])["total"] == 0  # idempotent
    assert tokenize("SSN 512-44-8890")["text"] == tokenize("SSN 512 44 8890")["text"]  # deterministic


def test_tokenize_endpoint_flags_residuals(client):
    d = data(client.post("/api/tokenize", json={"text": "call 415-555-0198", "client_tokenized": True}))
    assert d["residual_pii"] == 1 and d["verdict"] == "residual_tokenized"
    d = data(client.post("/api/tokenize", json={"text": "call [PHONE_ABC123]", "client_tokenized": True}))
    assert d["verdict"] == "clean"


def test_validation_errors(client):
    r = client.post("/api/trigger-incident", json={"title": ""})
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "validation_error"
    r = client.get("/api/incident-status/INC-NOPE")
    assert r.status_code == 404
    r = client.post("/api/simulate-call", json={"scenario_id": "nope"})
    assert r.status_code == 404


def test_policy_rejects_non_allowlisted_actions():
    decision, report = policy.enforce({
        "severity": "high", "threat_type": "Vishing", "summary": "Test summary for policy.", "confidence": 0.9,
        "priority_explanation": "test", "missing_information": [],
        "actions": [{"action": "LOCK_SIM", "params": {}, "priority": 1, "rationale": "lock it"},
                    {"action": "WIRE_MONEY", "params": {}, "priority": 2, "rationale": "malicious"},
                    {"action": "FREEZE_CREDIT", "params": {"bureau": "acme"}, "priority": 3, "rationale": "bad param"}]})
    assert [a.action for a in decision.actions] == ["LOCK_SIM"]
    assert {r["action"] for r in report["rejected"]} == {"WIRE_MONEY", "FREEZE_CREDIT"}
    bad, rep = policy.enforce({"severity": "apocalyptic"})
    assert bad is None and rep["schema_valid"] is False


def test_full_demo_journey(client):
    # 1. Suspicious call arrives
    call = data(client.post("/api/simulate-call", json={"scenario_id": "it-helpdesk"}))
    assert call["severity"] == "critical"
    assert {i["key"] for l in call["lines"] for i in l["interventions"]} == {"duck", "whisper", "flash"}

    # 2-4. Edge-tokenized transcript escalated into an incident; server re-validates
    transcript = [{"speaker": l["speaker"], "text": l["sanitized_text"]} for l in call["lines"]]
    st = data(client.post("/api/trigger-incident", json={
        "source": "call", "title": call["title"], "threat_type": call["threat_type"],
        "sanitized_transcript": transcript, "entities_removed": {"PHONE": 1, "SSN": 1, "OTP": 1, "PERSON": 2},
        "interventions": ["duck", "whisper", "flash"], "evidence_refs": [call["event_id"]]}), 201)
    inc_id = st["incident"]["id"]
    assert st["incident"]["status"] == "DETECTED"
    assert st["incident"]["privacy"]["server_residual"] == {}

    # 5. AI commander (demo engine) analyzes sanitized context
    st = data(client.post("/api/analyze-threat", json={"incident_id": inc_id}))
    analysis = st["incident"]["analysis"]
    assert analysis["engine"] == "demo" and analysis["policy"]["schema_valid"]
    assert not RAW_PII.search(str(analysis["context_sent"]))
    assert "LOCK_SIM" in analysis["policy"]["accepted"]

    # 6-7. Containment executes; TransUnion fails deterministically, operator retries
    st = data(client.post(f"/api/incidents/{inc_id}/contain?instant=true", json={"operator": "demo"}), 202)
    assert st["incident"]["status"] == "ATTENTION_REQUIRED"
    failed = [a for a in st["actions"] if a["status"] == "FAILED"]
    assert len(failed) == 1 and "TransUnion" in failed[0]["label"]
    st = data(client.post(f"/api/incidents/{inc_id}/actions/{failed[0]['id']}/retry?instant=true", json={}), 202)
    assert st["incident"]["status"] == "CONTAINED" and st["progress"]["percent"] == 100

    # Manual control + policy enforcement on manual actions
    r = client.post(f"/api/incidents/{inc_id}/actions", json={"action": "DROP_DATABASE"})
    assert r.status_code == 422
    st = data(client.post(f"/api/incidents/{inc_id}/actions?instant=true", json={"action": "BLOCK_PORT_OUT"}), 202)
    assert st["incident"]["status"] == "CONTAINED"

    # Timeline + tamper-evident chain
    tl = data(client.get(f"/api/incidents/{inc_id}/timeline"))
    kinds = [e["event_type"] for e in tl["events"]]
    assert kinds[0] == "incident.detected" and "containment.failed" in kinds and "incident.contained" in kinds
    assert audit.verify()["valid"]

    # 8. Legal report (JSON + PDF)
    rep = data(client.get(f"/api/legal-report/{inc_id}"))
    assert rep["status"].startswith("DRAFT") and rep["regulatory_scope"]["human_review_required"]
    assert rep["containment"]["failed"] == 0 and rep["facts"]["simulated"]
    assert not RAW_PII.search(str(rep))
    pdf = client.get(f"/api/legal-report/{inc_id}/pdf")
    assert pdf.status_code == 200 and pdf.data[:4] == b"%PDF"


def test_audit_chain_detects_tampering(client):
    from app.db import get_db
    db = get_db()
    target = db.audit_logs.find_one({"seq": 3})
    db.audit_logs.update_one({"seq": 3}, {"$set": {"summary": "tampered"}})
    result = audit.verify()
    assert result["valid"] is False and result["broken_at_seq"] == 3
    db.audit_logs.update_one({"seq": 3}, {"$set": {"summary": target["summary"]}})
    assert audit.verify()["valid"]


def test_telemetry_pipeline(client):
    d = data(client.post("/api/telemetry/simulate", json={"count": 5}), 201)
    assert len(d["events"]) == 5 and all(e["subscriber_token"].startswith("[PHONE_") for e in d["events"])
    d = data(client.get("/api/telemetry/events?limit=10"))
    assert len(d["events"]) == 10 and d["summary"]["total"] > 0


def test_no_raw_pii_persisted(client):
    from app.db import get_db
    db = get_db()
    for name in ("incidents", "sanitized_events", "containment_actions", "audit_logs"):
        for doc in db[name].find():
            assert not RAW_PII.search(str(doc)), f"raw PII found in {name}: {doc.get('_id')}"
