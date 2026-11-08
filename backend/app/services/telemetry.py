"""Proactive (BEFORE) defense: ingest simulated carrier telemetry through the risk pipeline."""
from .. import clock
from ..db import clean, get_db
from . import audit
from .simulator import generate_event


def ingest(count: int = 1) -> list[dict]:
    db = get_db()
    out = []
    for _ in range(count):
        seq = db.sanitized_events.count_documents({"kind": "telemetry"}) + 1
        ev = {**generate_event(seq), "kind": "telemetry", "seq": seq}
        ev["_id"] = f"EVT-{seq:05d}"
        db.sanitized_events.insert_one(ev)
        if ev["severity"] == "critical":
            audit.append("telemetry.flagged", f"Critical {ev['label'].lower()} on cell {ev['cell_id']} "
                         f"(risk {ev['risk_score']})", actor="carrier-telemetry", data={"event_id": ev["_id"]})
        out.append(clean(ev))
    return out


def recent(limit=60, min_risk=0) -> list[dict]:
    q = {"kind": "telemetry", "risk_score": {"$gte": min_risk}}
    return [clean(e) for e in get_db().sanitized_events.find(q, sort=[("created_at", -1)]).limit(limit)]


def summary() -> dict:
    events = recent(400)
    by_type: dict[str, int] = {}
    for e in events:
        if e["type"] != "NORMAL_ATTACH":
            by_type[e["label"]] = by_type.get(e["label"], 0) + 1
    flagged = [e for e in events if e["risk_score"] >= 60]
    return {
        "total": len(events), "flagged": len(flagged),
        "sim_swap_indicators": sum(e["type"] in {"SIM_SWAP_REQUEST", "PORT_OUT_REQUEST", "IMEI_CHANGE"} for e in flagged),
        "voip_suspicious": sum(e["type"] in {"VOIP_SPOOF", "ROBOCALL_BURST"} for e in flagged),
        "downgrades": sum(e["type"] == "NETWORK_DOWNGRADE" for e in events),
        "avg_risk": round(sum(e["risk_score"] for e in events) / len(events)) if events else 0,
        "by_type": sorted(({"label": k, "count": v} for k, v in by_type.items()), key=lambda x: -x["count"]),
        "generated_at": clock.now(),
    }
