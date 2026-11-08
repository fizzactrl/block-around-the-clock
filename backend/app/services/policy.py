"""Execution policy for AI-proposed actions.

The AI commander may only *propose*. Every proposal is schema-validated with
pydantic and filtered against this allowlist before the orchestrator will queue
it. Nothing the model emits is executed directly.
"""
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

ACTIONS = {
    "LOCK_SIM": {"label": "SIM / eSIM lock", "category": "carrier", "target": "Carrier SIM platform",
                 "params": {}, "default_priority": 1},
    "BLOCK_PORT_OUT": {"label": "Port-out block", "category": "carrier", "target": "Carrier porting gateway",
                       "params": {}, "default_priority": 2},
    "ENABLE_CALL_SHIELD": {"label": "Carrier call shield", "category": "carrier", "target": "Carrier voice core",
                           "params": {}, "default_priority": 3},
    "REVOKE_SESSIONS": {"label": "Session revocation", "category": "identity", "target": "Identity provider",
                        "params": {"scope": ["all", "workforce_sso", "email", "banking"]}, "default_priority": 2},
    "RESET_CREDENTIALS": {"label": "Credential reset", "category": "identity", "target": "Identity provider",
                          "params": {}, "default_priority": 4},
    "FREEZE_CREDIT": {"label": "Credit freeze", "category": "credit", "target": "Credit bureau",
                      "params": {"bureau": ["equifax", "experian", "transunion"]}, "default_priority": 5},
    "PLACE_FRAUD_ALERT": {"label": "Fraud alert", "category": "credit", "target": "Credit bureau",
                          "params": {"bureau": ["equifax", "experian", "transunion"]}, "default_priority": 6},
    "ALERT_BANK_FRAUD": {"label": "Bank fraud alert", "category": "financial", "target": "Bank fraud desk",
                         "params": {}, "default_priority": 3},
}

BUREAU_NAMES = {"equifax": "Equifax", "experian": "Experian", "transunion": "TransUnion"}


class ProposedAction(BaseModel):
    action: str
    params: dict = Field(default_factory=dict)
    priority: int = Field(ge=1, le=10)
    rationale: str = Field(min_length=3, max_length=600)


class Decision(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    threat_type: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=10, max_length=1600)
    confidence: float = Field(ge=0, le=1)
    actions: list[ProposedAction] = Field(max_length=12)
    priority_explanation: str = Field(min_length=3, max_length=1200)
    missing_information: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("missing_information")
    @classmethod
    def _trim(cls, v):
        return [s[:240] for s in v]


def validate_action(action: str, params: dict | None) -> tuple[bool, str]:
    spec = ACTIONS.get(action)
    if not spec:
        return False, f"'{action}' is not on the execution allowlist"
    params = params or {}
    for key in params:
        if key not in spec["params"]:
            return False, f"parameter '{key}' not permitted for {action}"
    for key, allowed in spec["params"].items():
        if key not in params:
            return False, f"missing required parameter '{key}' for {action}"
        if params[key] not in allowed:
            return False, f"value '{params[key]}' not permitted for {action}.{key}"
    return True, "ok"


def enforce(raw: dict) -> tuple[Decision | None, dict]:
    """Validate a raw model decision. Returns (decision_with_allowed_actions, report)."""
    try:
        decision = Decision.model_validate(raw)
    except ValidationError as exc:
        return None, {"schema_valid": False, "errors": [e["msg"] + " @ " + ".".join(map(str, e["loc"]))
                                                         for e in exc.errors()][:8], "accepted": [], "rejected": []}
    accepted, rejected, seen = [], [], set()
    for a in sorted(decision.actions, key=lambda x: x.priority):
        ok, reason = validate_action(a.action, a.params)
        key = (a.action, tuple(sorted(a.params.items())))
        if ok and key in seen:
            ok, reason = False, "duplicate action"
        (accepted if ok else rejected).append({**a.model_dump(), **({} if ok else {"reason": reason})})
        if ok:
            seen.add(key)
    decision.actions = [ProposedAction(**{k: v for k, v in a.items() if k != "reason"}) for a in accepted]
    return decision, {"schema_valid": True, "errors": [], "accepted": [a["action"] for a in accepted],
                      "rejected": rejected}


def describe(action: str, params: dict) -> str:
    spec = ACTIONS[action]
    if action in ("FREEZE_CREDIT", "PLACE_FRAUD_ALERT"):
        return f"{spec['label']} · {BUREAU_NAMES[params['bureau']]}"
    if action == "REVOKE_SESSIONS":
        return f"{spec['label']} · {params['scope'].replace('_', ' ')}"
    return spec["label"]
