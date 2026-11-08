"""Seed realistic demo history: ~24h of carrier telemetry plus three resolved incidents.
Operations run in chronological order under a frozen clock so the audit hash-chain
is consistent and timestamps look natural."""
import random
from datetime import timedelta

from . import clock
from .db import get_db
from .services import orchestrator, telemetry
from .services.simulator import build_call
from .services.tokenizer import tokenize


def _incident_from_call(scenario_id: str):
    call = build_call(scenario_id)
    transcript = [{"speaker": l["speaker"], "text": l["sanitized_text"]} for l in call["lines"]]
    entities: dict[str, int] = {}
    for l in call["lines"]:
        for k, n in l["entities"].items():
            entities[k] = entities.get(k, 0) + n
    from .services.simulator import CALL_SCENARIOS
    meta = CALL_SCENARIOS[scenario_id]["caller"]
    return dict(source="call", title=call["title"], threat_type=call["threat_type"], transcript=transcript,
                metadata=meta, client_privacy={"entities_removed": entities, "edge_tokenized": True},
                interventions=["duck", "whisper", "flash"], evidence_refs=[f"call:{scenario_id}"], seeded=True)


def _smishing_incident():
    lines = ["Text: Chase alert — unusual sign-in. Verify now at chase-secure-verify.top or your account will be "
             "suspended within the next 2 hours.",
             "Text: Reply with the code 662019 we sent to confirm it's you. Do not tell anyone this code."]
    transcript = [{"speaker": "sender", "text": tokenize(l)["text"]} for l in lines]
    return dict(source="telemetry", title="Smishing campaign · bank credential lure",
                threat_type="Smishing — credential harvesting link", transcript=transcript,
                metadata={"attestation": "", "first_contact": True, "spoofed_brand": True},
                client_privacy={"entities_removed": {"BANK": 1, "OTP": 1}, "edge_tokenized": True},
                interventions=["sms-quarantine"], evidence_refs=["EVT-00042"], seeded=True)


def _resolve(spec, start):
    """Run the full lifecycle for a seeded incident at realistic offsets."""
    with clock.frozen(start):
        inc = orchestrator.create_incident(**spec)
    with clock.frozen(start + timedelta(seconds=38)):
        orchestrator.analyze(inc["_id"], force_demo=True)  # seeded history: deterministic, no API calls
    with clock.frozen(start + timedelta(minutes=2, seconds=10)):
        orchestrator.contain(inc["_id"], approved=None, operator="soc-analyst", instant=True)
    with clock.frozen(start + timedelta(minutes=7, seconds=45)):
        if orchestrator.status_payload(inc["_id"])["progress"]["failed"]:
            for a in orchestrator.actions_for(inc["_id"]):
                if a["status"] == "FAILED":
                    orchestrator.retry_action(inc["_id"], a["id"], "soc-analyst", instant=True)


def seed(force=False) -> bool:
    db = get_db()
    if not force and db.incidents.count_documents({}) > 0:
        return False
    if force:
        for name in ("incidents", "sanitized_events", "containment_actions", "audit_logs"):
            db[name].delete_many({})

    now = clock.now_dt()
    rng = random.Random(2026)
    ops = []
    t = now - timedelta(hours=24)
    while t < now - timedelta(minutes=2):
        ops.append((t, lambda: telemetry.ingest(1)))
        t += timedelta(seconds=rng.randint(240, 720))
    ops.append((now - timedelta(hours=20, minutes=12), lambda: _resolve(_incident_from_call("bank-fraud"),
                                                                        now - timedelta(hours=20, minutes=12))))
    ops.append((now - timedelta(hours=9, minutes=41), lambda: _resolve(_incident_from_call("sim-swap"),
                                                                       now - timedelta(hours=9, minutes=41))))
    ops.append((now - timedelta(hours=3, minutes=5), lambda: _resolve(_smishing_incident(),
                                                                      now - timedelta(hours=3, minutes=5))))
    for when, fn in sorted(ops, key=lambda o: o[0]):
        with clock.frozen(when):
            fn()
    return True


if __name__ == "__main__":
    from .db import init_db
    init_db()
    print("seeded" if seed(force=True) else "already seeded")
