"""Deterministic risk engine. Operates only on *sanitized* text and carrier metadata."""
import re

SIGNALS = [
    ("credential_request", "Requests a one-time code or PIN", 24,
     r"verification code|one[- ]time|\bOTP\b|passcode|\bPIN\b|read (it|that) back|\[OTP_"),
    ("ssn_request", "Requests a Social Security number", 20, r"social security|\[SSN_"),
    ("urgency", "Manufactured urgency or threat", 12,
     r"immediately|right now|urgent|within the next|suspended|be locked|frozen|before it"),
    ("authority_impersonation", "Impersonates IT, bank or carrier staff", 15,
     r"service desk|help ?desk|fraud department|security team|IT support|carrier support|from \[BANK_"),
    ("remote_access", "Pushes remote-access software", 20, r"anydesk|teamviewer|remote access|screen ?share|install"),
    ("sim_transfer", "Attempts SIM / eSIM transfer or port-out", 22,
     r"port(ing)? (your|the) number|transfer (your|the) number|new SIM|eSIM|port-out|transfer PIN"),
    ("payment_redirect", "Redirects funds or payment", 20, r"gift card|wire|crypto|bitcoin|zelle|safe account|move (the|your) (funds|money)"),
    ("secrecy", "Demands secrecy or isolation", 10, r"don'?t tell|do not tell|keep this between|don'?t hang up|stay on the line"),
]
_COMPILED = [(k, label, w, re.compile(rx, re.IGNORECASE)) for k, label, w, rx in SIGNALS]

METADATA_FACTORS = {
    "attestation_c": ("STIR/SHAKEN attestation C (unverified origin)", 10),
    "attestation_b": ("STIR/SHAKEN attestation B (partial)", 6),
    "voip_origin": ("Originated on wholesale VoIP gateway", 6),
    "spoofed_brand": ("Caller ID mimics a known institution", 6),
    "first_contact": ("No prior relationship with this number", 3),
}


def signals_in(text: str) -> list[dict]:
    return [{"key": k, "label": label, "weight": w} for k, label, w, rx in _COMPILED if rx.search(text)]


def metadata_score(meta: dict) -> tuple[int, list[dict]]:
    hits = []
    att = (meta.get("attestation") or "").upper()
    if att == "C":
        hits.append("attestation_c")
    elif att == "B":
        hits.append("attestation_b")
    for flag in ("voip_origin", "spoofed_brand", "first_contact"):
        if meta.get(flag):
            hits.append(flag)
    factors = [{"key": h, "label": METADATA_FACTORS[h][0], "weight": METADATA_FACTORS[h][1]} for h in hits]
    return sum(f["weight"] for f in factors), factors


def severity_for(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def score_transcript(lines: list[str], meta: dict) -> dict:
    """Cumulative score: each distinct signal counts once, with metadata as a baseline."""
    base, factors = metadata_score(meta)
    seen: dict[str, dict] = {}
    progression = []
    for line in lines:
        for sig in signals_in(line):
            seen.setdefault(sig["key"], sig)
        progression.append(min(99, base + sum(s["weight"] for s in seen.values())))
    score = progression[-1] if progression else min(99, base)
    return {"score": score, "severity": severity_for(score), "progression": progression,
            "signals": list(seen.values()), "metadata_factors": factors}
