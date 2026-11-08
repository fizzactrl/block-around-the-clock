"""AI incident commander.

Uses NVIDIA Nemotron (OpenAI-compatible NVIDIA API) when NVIDIA_API_KEY is set,
otherwise a deterministic, clearly-labelled demo engine. In both cases:
  * only sanitized context is sent (re-scanned server-side first), and
  * the output is a *proposal* that must pass policy.enforce() before queueing.
"""
import json
import re
import time

import requests

from ..config import Config
from . import policy
from .tokenizer import sanitize_tree

SYSTEM_PROMPT = """/no_think
You are the AI incident commander for a carrier-side identity-theft defense system.
You receive SANITIZED incident context: personal data has been replaced by tokens like [PHONE_1A2B3C].
Never attempt to guess or reconstruct tokenized values.

Respond with ONE JSON object and nothing else, matching exactly:
{
  "severity": "low" | "medium" | "high" | "critical",
  "threat_type": string,
  "summary": string (2-4 sentences, factual, reference tokens not personal data),
  "confidence": number 0..1,
  "actions": [ { "action": ACTION, "params": object, "priority": 1..10 (1 = first), "rationale": string } ],
  "priority_explanation": string,
  "missing_information": [ string ]
}
ACTION must be one of (params are required exactly as listed):
  LOCK_SIM {}                     – lock SIM/eSIM changes
  BLOCK_PORT_OUT {}               – freeze number port-out
  ENABLE_CALL_SHIELD {}           – screen unverified calls to subscriber
  REVOKE_SESSIONS {"scope": "all"|"workforce_sso"|"email"|"banking"}
  RESET_CREDENTIALS {}            – force password reset + MFA re-enrollment
  FREEZE_CREDIT {"bureau": "equifax"|"experian"|"transunion"} – one action per bureau
  ALERT_BANK_FRAUD {}             – alert bank fraud desk, hold outbound transfers
Propose only actions justified by the evidence. You propose; a policy engine and a human decide."""


def _context(incident: dict) -> dict:
    return {
        "incident_id": incident["_id"],
        "source": incident["source"],
        "threat_type_hint": incident.get("threat_type"),
        "risk_score": incident.get("risk_score"),
        "severity_hint": incident.get("severity"),
        "signals": [s["label"] for s in incident.get("signals", [])],
        "carrier_metadata": [f["label"] for f in incident.get("metadata_factors", [])],
        "pii_categories_observed": sorted(incident.get("privacy", {}).get("entities_removed", {}).keys()),
        "sanitized_transcript": [f'{l["speaker"]}: {l["text"]}' for l in incident.get("sanitized_transcript", [])],
        "interventions_applied": incident.get("interventions", []),
    }


def analyze(incident: dict, force_demo: bool = False) -> dict:
    context, residual = sanitize_tree(_context(incident))
    started = time.perf_counter()
    engine, model, error, raw = "demo", "deterministic-rules-v1", None, None

    if Config.NVIDIA_API_KEY and not force_demo:
        try:
            raw = _call_nemotron(context)
            engine, model = "nemotron", Config.NEMOTRON_MODEL
        except Exception as exc:  # never silently substitute a mock when Nemotron is configured
            from ..errors import ApiError
            raise ApiError(502, "nemotron_unavailable", f"Nemotron call failed: {type(exc).__name__}: {str(exc)[:200]}")
    if raw is None:
        raw = _demo_decision(incident)

    decision, report = policy.enforce(raw)
    if decision is None:
        from ..errors import ApiError
        raise ApiError(502, "invalid_model_output", "Nemotron output failed schema validation: " + "; ".join(report["errors"][:3]))

    return {
        "engine": engine, "model": model, "error": error,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "decision": decision.model_dump(), "policy": report,
        "context_sent": context, "server_residual_pii": residual,
    }


def _call_nemotron(context: dict) -> dict:
    resp = requests.post(
        f"{Config.NVIDIA_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {Config.NVIDIA_API_KEY}", "Accept": "application/json"},
        json={"model": Config.NEMOTRON_MODEL, "temperature": 0.1, "top_p": 0.9, "max_tokens": 1400,
              "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                           {"role": "user", "content": "Sanitized incident context:\n" + json.dumps(context, indent=2)}]},
        timeout=Config.NEMOTRON_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"] or ""
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
    content = re.sub(r"```(?:json)?", "", content)
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in model response")
    return json.loads(content[start:end + 1])


def _demo_decision(incident: dict) -> dict:
    """Deterministic rules that mirror what an analyst playbook would propose."""
    keys = {s["key"] for s in incident.get("signals", [])}
    pii = set(incident.get("privacy", {}).get("entities_removed", {}).keys())
    actions: list[dict] = []

    def add(action, priority, rationale, **params):
        actions.append({"action": action, "params": params, "priority": priority, "rationale": rationale})

    if keys & {"credential_request", "sim_transfer"} or "OTP" in pii:
        add("LOCK_SIM", 1, "One-time codes were solicited; locking SIM/eSIM changes prevents the attacker from "
                           "redirecting future codes via a SIM swap.")
    if "sim_transfer" in keys:
        add("BLOCK_PORT_OUT", 1, "Caller attempted an eSIM transfer; a port-out freeze stops number hijacking.")
    if keys & {"credential_request", "remote_access"}:
        add("REVOKE_SESSIONS", 2, "A verification code may have been disclosed; revoke live sessions and refresh "
                                  "tokens before they can be reused.", scope="workforce_sso" if "remote_access" in keys else "all")
        add("RESET_CREDENTIALS", 3, "Force a password reset and MFA re-enrollment to invalidate any captured factor.")
    if "payment_redirect" in keys or "BANK" in pii:
        add("ALERT_BANK_FRAUD", 2, "Caller attempted to redirect funds; hold outbound wires and P2P transfers.")
        add("REVOKE_SESSIONS", 3, "Revoke online-banking sessions that may have been established.", scope="banking")
    if "ssn_request" in keys or "SSN" in pii:
        for i, bureau in enumerate(["equifax", "experian", "transunion"]):
            add("FREEZE_CREDIT", 4 + i, f"SSN exposure enables new-account fraud; freeze credit at {policy.BUREAU_NAMES[bureau]}.",
                bureau=bureau)
    add("ENABLE_CALL_SHIELD", 6, "Screen follow-up calls from unverified (attestation C) origins with a carrier whisper.")

    labels = ", ".join(s["label"].lower() for s in incident.get("signals", [])[:4]) or "suspicious carrier activity"
    missing = ["Whether the subscriber actually disclosed the one-time code"] if "credential_request" in keys else []
    if "remote_access" in keys:
        missing.append("Whether remote-access software was installed on any device")
    if "ssn_request" in keys:
        missing.append("Which financial institutions the subscriber holds accounts with")
    missing.append("SIM and device change history for the last 30 days")
    severity = incident.get("severity", "high")
    return {
        "severity": severity if severity in {"low", "medium", "high", "critical"} else "high",
        "threat_type": incident.get("threat_type") or "Social engineering",
        "summary": (f"Incident {incident['_id']} shows a {severity} risk social-engineering attempt (risk score "
                    f"{incident.get('risk_score')}). Observed indicators: {labels}. The subscriber identity and contact "
                    f"details are tokenized; no raw personal data was processed."),
        "confidence": round(min(0.97, 0.55 + (incident.get("risk_score") or 0) / 250), 2),
        "actions": actions,
        "priority_explanation": ("Carrier-level controls go first because they cut off the attacker's ability to "
                                 "intercept new codes. Identity and financial controls follow to neutralize anything "
                                 "already captured; credit freezes address longer-term SSN exposure."),
        "missing_information": missing,
    }
