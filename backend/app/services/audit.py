"""Append-only audit log with SHA-256 hash chaining for tamper *evidence*.

Each entry stores the hash of its predecessor; altering or deleting any entry
breaks verification of every entry after it. This is a demo of tamper-evidence,
not cryptographically immutable storage (a DB admin could rewrite the chain).
"""
import hashlib
import json
import threading

from .. import clock
from ..db import clean, get_db

GENESIS = "0" * 64
_lock = threading.Lock()


def _digest(prev_hash: str, entry: dict) -> str:
    canonical = json.dumps(entry, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256((prev_hash + canonical).encode()).hexdigest()


def append(event_type: str, summary: str, *, actor: str = "system", incident_id: str | None = None,
           data: dict | None = None, simulated: bool = True) -> dict:
    db = get_db()
    with _lock:
        last = db.audit_logs.find_one(sort=[("seq", -1)])
        seq = (last["seq"] + 1) if last else 1
        prev_hash = last["hash"] if last else GENESIS
        entry = {"seq": seq, "ts": clock.now(), "event_type": event_type, "summary": summary,
                 "actor": actor, "incident_id": incident_id, "data": data or {}, "simulated": simulated}
        record = {**entry, "prev_hash": prev_hash, "hash": _digest(prev_hash, entry)}
        db.audit_logs.insert_one(record)
    return clean(record)


def verify() -> dict:
    prev, count = GENESIS, 0
    for rec in get_db().audit_logs.find(sort=[("seq", 1)]):
        entry = {k: rec[k] for k in ("seq", "ts", "event_type", "summary", "actor", "incident_id", "data", "simulated")}
        if rec["prev_hash"] != prev or _digest(prev, entry) != rec["hash"]:
            return {"valid": False, "entries": count, "broken_at_seq": rec["seq"], "head": prev}
        prev, count = rec["hash"], count + 1
    return {"valid": True, "entries": count, "broken_at_seq": None, "head": prev}


def for_incident(incident_id: str) -> list[dict]:
    return [clean(r) for r in get_db().audit_logs.find({"incident_id": incident_id}, sort=[("seq", 1)])]


def recent(limit: int = 12) -> list[dict]:
    return [clean(r) for r in get_db().audit_logs.find(sort=[("seq", -1)]).limit(limit)]
