"""MongoDB access. Uses a real MongoDB when MONGODB_URI is reachable, otherwise an
in-process pymongo-compatible store (mongomock) so the demo always runs."""
import logging

from pymongo import ASCENDING, DESCENDING, MongoClient

from .config import Config

log = logging.getLogger(__name__)

_db = None
_mode = "uninitialized"

COLLECTIONS = ("incidents", "sanitized_events", "containment_actions", "audit_logs", "agent_runs", "eval_runs")


def init_db(force_memory: bool = False):
    global _db, _mode
    if Config.MONGODB_URI and not force_memory:
        try:
            import certifi  # explicit CA bundle: python.org macOS builds ship without system CAs
            client = MongoClient(Config.MONGODB_URI, serverSelectionTimeoutMS=8000, tlsCAFile=certifi.where(),
                                 appname="block-around-the-clock")
            client.admin.command("ping")
            _db = client[Config.MONGODB_DB]
            _mode = "mongodb"
        except Exception as exc:  # pragma: no cover - depends on environment
            log.warning("MongoDB unreachable (%s); falling back to in-memory store", exc)
            _db = None
    if _db is None:
        import mongomock
        _db = mongomock.MongoClient()[Config.MONGODB_DB]
        _mode = "memory"
    _ensure_indexes()
    return _db


def _ensure_indexes():
    _db.incidents.create_index([("created_at", DESCENDING)])
    _db.sanitized_events.create_index([("created_at", DESCENDING)])
    _db.containment_actions.create_index([("incident_id", ASCENDING), ("sequence", ASCENDING)])
    _db.audit_logs.create_index([("seq", ASCENDING)], unique=True)
    _db.audit_logs.create_index([("incident_id", ASCENDING)])
    _db.agent_runs.create_index([("incident_id", ASCENDING), ("started_at", DESCENDING)])
    _db.eval_runs.create_index([("started_at", DESCENDING)])


def get_db():
    if _db is None:
        init_db()
    return _db


def mode() -> str:
    return _mode


def clean(doc):
    """Strip Mongo internals so documents serialize cleanly to JSON."""
    if doc is None:
        return None
    out = dict(doc)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    return out
