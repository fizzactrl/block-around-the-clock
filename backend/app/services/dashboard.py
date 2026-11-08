"""Command-center aggregation."""
from datetime import timedelta

from .. import clock
from ..db import get_db, mode
from . import audit, orchestrator, telemetry

ACTIVE = {"DETECTED", "ANALYZED", "CONTAINING", "ATTENTION_REQUIRED"}


def build() -> dict:
    db = get_db()
    incidents = orchestrator.list_incidents(100)
    for i in incidents:
        if i["status"] in {"CONTAINING"}:
            orchestrator.advance(i["id"])
    incidents = orchestrator.list_incidents(100)
    active = [i for i in incidents if i["status"] in ACTIVE]
    now = clock.now_dt()
    since = clock.iso(now - timedelta(hours=24))
    events = list(db.sanitized_events.find({"kind": "telemetry", "created_at": {"$gte": since}}))

    buckets = []
    for h in range(23, -1, -1):
        start = now - timedelta(hours=h + 1)
        end = now - timedelta(hours=h)
        s, e = clock.iso(start), clock.iso(end)
        window = [x for x in events if s <= x["created_at"] < e]
        buckets.append({"hour": clock.iso(end), "label": f"{end:%H}:00",
                        "critical": sum(x["severity"] == "critical" for x in window),
                        "high": sum(x["severity"] == "high" for x in window),
                        "medium": sum(x["severity"] == "medium" for x in window),
                        "low": sum(x["severity"] == "low" for x in window)})

    acts = list(db.containment_actions.find())
    succeeded = sum(a["status"] == "SUCCEEDED" for a in acts)
    contained = [i for i in incidents if i["status"] == "CONTAINED"]
    mttc = []
    for i in contained:
        doc = db.incidents.find_one({"_id": i["id"]})
        if doc.get("contained_at"):
            mttc.append((clock.parse(doc["contained_at"]) - clock.parse(doc["created_at"])).total_seconds())

    threats_24h = sum(x["risk_score"] >= 60 for x in events)
    crit_active = any(i["severity"] == "critical" for i in active)
    posture = "under_attack" if crit_active else ("elevated" if active else "protected")
    score = max(12, 100 - 18 * len(active) - (12 if crit_active else 0) - min(8, threats_24h // 12))
    sev = {k: sum(i["severity"] == k for i in incidents) for k in ("critical", "high", "medium", "low")}
    return {
        "protection": {"posture": posture, "score": score, "label": {"protected": "Protected", "elevated": "Elevated risk",
                                                                      "under_attack": "Active attack"}[posture]},
        "metrics": {"active_incidents": len(active), "threats_detected_24h": threats_24h,
                    "incidents_contained": len(contained), "events_analyzed_24h": len(events),
                    "containment_progress": round(100 * succeeded / len(acts)) if acts else 100,
                    "actions_succeeded": succeeded, "actions_total": len(acts),
                    "mean_time_to_contain_s": round(sum(mttc) / len(mttc)) if mttc else None},
        "threat_timeline": buckets,
        "severity_distribution": [{"severity": k, "count": v} for k, v in sev.items()],
        "threat_mix": telemetry.summary()["by_type"][:6],
        "incidents": incidents[:8],
        "active_incidents": active[:5],
        "recent_activity": audit.recent(14),
        "audit_chain": audit.verify(),
        "system": {"database": mode(), "generated_at": clock.now()},
    }
