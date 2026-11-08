"""Deterministic privacy tokenization.

Sensitive values are replaced with keyed HMAC tokens such as ``[PHONE_3F9A1C]``.
The same value always yields the same token (so analysts can correlate), but no
reverse map is ever created or stored, so tokens cannot be turned back into PII
by anyone holding the database.
"""
import hashlib
import hmac
import json
import re
from functools import lru_cache
from pathlib import Path

from ..config import Config

POLICY_PATH = Path(__file__).resolve().parents[3] / "shared" / "privacy-policy.json"
TOKEN_RE = re.compile(r"\[[A-Z]+_[0-9A-F]{6}\]")


@lru_cache(maxsize=1)
def policy() -> dict:
    return json.loads(POLICY_PATH.read_text())


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def _dict_pattern(words: list[str]) -> str:
    return "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))


@lru_cache(maxsize=1)
def _compiled():
    p = policy()
    dicts = p["dictionaries"]
    out = []
    for det in p["detectors"]:
        flags = re.IGNORECASE if "i" in det.get("flags", "") else 0
        if det.get("dictionary") == "banks":
            source = rf"\b(?:{_dict_pattern(dicts['banks'])})(?![A-Za-z])"
        elif det.get("dictionary") == "names":
            firsts, lasts = _dict_pattern(dicts["first_names"]), _dict_pattern(dicts["last_names"])
            source = rf"\b(?:(?:{firsts})(?: [A-Z][a-z]+)?|(?:{lasts}))\b"
        else:
            source = det["pattern"]
        out.append((det, re.compile(source, flags)))
    return out


def _normalize(kind: str, value: str) -> str:
    if kind in {"CARD", "SSN", "PHONE", "ACCOUNT", "OTP"}:
        digits = re.sub(r"\D", "", value)
        return digits[-10:] if kind == "PHONE" else digits
    return value.strip().lower()


def make_token(kind: str, value: str) -> str:
    digest = hmac.new(Config.TOKENIZATION_SECRET.encode(),
                      f"{kind}:{_normalize(kind, value)}".encode(), hashlib.sha256).hexdigest()
    return f"[{kind}_{digest[:6].upper()}]"


def scan(text: str) -> list[dict]:
    """Find PII spans. Earlier detectors win on overlap. Existing tokens are skipped."""
    taken = [(m.start(), m.end()) for m in TOKEN_RE.finditer(text)]
    found = []

    def free(s, e):
        return all(e <= ts or s >= te for ts, te in taken)

    for det, rx in _compiled():
        group = det.get("group", 0)
        for m in rx.finditer(text):
            s, e = m.span(group)
            if s < 0 or not free(s, e):
                continue
            value = m.group(group)
            if det.get("luhn") and not _luhn(re.sub(r"\D", "", value)):
                continue
            taken.append((s, e))
            found.append({"type": det["type"], "label": det["label"], "start": s, "end": e,
                          "token": make_token(det["type"], value)})
    return sorted(found, key=lambda f: f["start"])


def tokenize(text: str) -> dict:
    entities = scan(text)
    parts, cursor = [], 0
    for ent in entities:
        parts.append(text[cursor:ent["start"]])
        parts.append(ent["token"])
        cursor = ent["end"]
    parts.append(text[cursor:])
    counts: dict[str, int] = {}
    for ent in entities:
        counts[ent["type"]] = counts.get(ent["type"], 0) + 1
    return {"text": "".join(parts), "entities": entities, "counts": counts, "total": len(entities)}


def sanitize_tree(value):
    """Defense in depth: walk any JSON-like structure and tokenize residual PII in strings.
    Returns (sanitized_value, residual_counts)."""
    residual: dict[str, int] = {}

    def walk(v):
        if isinstance(v, str):
            res = tokenize(v)
            for k, n in res["counts"].items():
                residual[k] = residual.get(k, 0) + n
            return res["text"]
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return walk(value), residual
