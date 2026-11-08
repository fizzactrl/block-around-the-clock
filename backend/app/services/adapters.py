"""Deterministic, STATEFUL simulated containment adapters.

No adapter contacts a real carrier, bank, identity provider or credit bureau.
Each incident carries a visible *simulated environment* (``sim_env``) describing
conditions in the outside world, e.g. a port-out already in flight or a bureau
API outage. Adapters read and mutate that state, so failures are caused by the
environment and can be resolved by the right corrective action — which is what
lets the Nemotron agent genuinely diagnose and replan.
"""
import hashlib

from ..config import Config
from .policy import BUREAU_NAMES

CONDITION_LABELS = {
    "port_out_pending": "A fraudulent port-out request is already in flight for this number",
    "bureau_outage": "Credit bureau API outage",
}


def _ref(prefix: str, *parts) -> str:
    return f"{prefix}-" + hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8].upper()


def new_env(conditions: dict | None = None) -> dict:
    conditions = dict(conditions or {})
    return {"conditions": conditions, "state": {
        "port_out_pending": bool(conditions.get("port_out_pending")),
        "bureau_outage": list(conditions.get("bureau_outage", [])),
        "applied": [],
    }}


def describe_env(env: dict | None) -> list[str]:
    if not env:
        return []
    out = []
    c = env.get("conditions", {})
    if c.get("bureau_outage_first_attempt"):
        out.append("Transient credit bureau error on first TransUnion attempt")
    if c.get("port_out_pending"):
        out.append(CONDITION_LABELS["port_out_pending"])
    for b in c.get("bureau_outage", []):
        out.append(f"{CONDITION_LABELS['bureau_outage']} · {BUREAU_NAMES[b]}")
    return out


def _key(action: str, params: dict) -> str:
    return action + ":" + ",".join(f"{k}={v}" for k, v in sorted(params.items()))


def execute(action: str, params: dict, incident_id: str, attempt: int, env: dict | None = None) -> dict:
    """Returns {ok, code, message, reference, simulated}. Mutates ``env['state']`` when given."""
    if env is None:  # legacy path (seeding / plan-based containment)
        env = new_env({"bureau_outage_first_attempt": True} if Config.SIMULATE_ADAPTER_FAILURE else {})
    st = env["state"]
    key = _key(action, params)
    if key in st["applied"]:
        return _ok("NO_OP", _ref("NOOP", incident_id, key), "Control already in effect; no change made (idempotent).")

    res = _dispatch(action, params, incident_id, attempt, env)
    if res["ok"]:
        st["applied"].append(key)
    return res


def _dispatch(action, params, incident_id, attempt, env) -> dict:
    st, cond = env["state"], env.get("conditions", {})
    if action == "LOCK_SIM":
        if st["port_out_pending"]:
            return _fail("PORT_OUT_IN_PROGRESS",
                         f"409 Conflict: port-out request {_ref('PRT', incident_id)} is in flight for this MSISDN. The SIM/eSIM "
                         "profile is held by the porting workflow and cannot be locked until the port-out is cancelled.")
        return _ok("LOCKED", _ref("SIMLCK", incident_id), "SIM and eSIM profile changes locked; swap & reprovision blocked.")
    if action == "BLOCK_PORT_OUT":
        was = st["port_out_pending"]
        st["port_out_pending"] = False
        return _ok("PORT_FROZEN", _ref("PORT", incident_id),
                   (f"Pending port-out {_ref('PRT', incident_id)} cancelled and " if was else "") +
                   "port-out freeze applied; future porting requests will be rejected.")
    if action == "ENABLE_CALL_SHIELD":
        return _ok("SHIELD_ON", _ref("SHLD", incident_id), "Attestation-C calls to subscriber now screened with security whisper.")
    if action == "REVOKE_SESSIONS":
        n = {"all": 14, "workforce_sso": 6, "email": 3, "banking": 2}[params["scope"]]
        return _ok("REVOKED", _ref("SESS", incident_id, params["scope"]), f"{n} active sessions and refresh tokens revoked.")
    if action == "RESET_CREDENTIALS":
        return _ok("RESET", _ref("CRED", incident_id), "Password reset forced; MFA factors re-enrollment required.")
    if action == "ALERT_BANK_FRAUD":
        return _ok("ALERTED", _ref("BANK", incident_id), "Fraud desk alert lodged; outbound wires & P2P transfers held for review.")
    if action in ("FREEZE_CREDIT", "PLACE_FRAUD_ALERT"):
        bureau = params["bureau"]
        name = BUREAU_NAMES[bureau]
        if bureau in st["bureau_outage"] or (cond.get("bureau_outage_first_attempt") and bureau == "transunion"
                                              and action == "FREEZE_CREDIT" and attempt == 1):
            persistent = bureau in st["bureau_outage"]
            return _fail("BUREAU_UNAVAILABLE",
                         f"503 Service Unavailable from {name} API." +
                         (" Status page reports a sustained outage (estimated 4h). Retrying during the outage will not succeed."
                          if persistent else " Transient error; retry may succeed."))
        if action == "PLACE_FRAUD_ALERT":
            others = [BUREAU_NAMES[b] for b in BUREAU_NAMES if b != bureau]
            return _ok("FRAUD_ALERT", _ref("FA", incident_id, bureau),
                       f"Initial 1-year fraud alert placed with {name}. Per bureau policy {name} notifies {others[0]} and "
                       f"{others[1]}, so the alert propagates to all three bureaus.")
        return _ok("FROZEN", _ref("FRZ", incident_id, bureau), f"Security freeze placed with {name}.")
    raise ValueError(f"no adapter for {action}")


def _ok(code: str, reference: str, message: str) -> dict:
    return {"ok": True, "code": code, "simulated": True, "reference": reference, "message": message}


def _fail(code: str, message: str) -> dict:
    return {"ok": False, "code": code, "simulated": True, "reference": None, "message": message}
