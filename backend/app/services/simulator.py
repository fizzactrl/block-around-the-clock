"""Synthetic carrier simulator: suspicious call scripts and network telemetry.

Everything here is SYNTHETIC demo data. Names, numbers and SSNs are fabricated
(555 numbers, invalid SSN ranges) and exist only to exercise the privacy engine.
"""
import random

from .. import clock
from . import risk
from .tokenizer import make_token, tokenize

INTERVENTIONS = [
    (45, "duck", "Audio ducking engaged", "Caller audio attenuated to -12 dB while risk is assessed."),
    (65, "whisper", "Security whisper delivered", "Private carrier whisper played to the subscriber only."),
    (85, "flash", "Flash alert raised", "Full-screen security alert shown (simulated Class 0 style)."),
]

CALL_SCENARIOS = {
    "it-helpdesk": {
        "title": "Fake IT helpdesk · credential reset",
        "threat_type": "Vishing — IT helpdesk impersonation",
        "caller": {"display_name": "IT Service Desk", "number": "+1 (415) 555-0142",
                   "carrier_route": "Wholesale VoIP gateway · SIP trunk", "location": "Unknown (VoIP)",
                   "attestation": "C", "voip_origin": True, "spoofed_brand": True, "first_contact": True},
        "subscriber": "Maya Chen",
        "environment": {"bureau_outage": ["transunion"]},
        "lines": [
            ("caller", "Hi, is this Maya Chen? This is Daniel calling from the corporate IT service desk."),
            ("subscriber", "Yes, this is Maya. What's going on?"),
            ("caller", "We detected a suspicious sign-in on your account and need to verify you right now, before it gets locked."),
            ("caller", "I just sent a verification code to 415-555-0198. Can you read it back to me? It should say code 482913."),
            ("subscriber", "Okay... but why do you need the code?"),
            ("caller", "Standard procedure. I'll also need to confirm the Social Security number on file, 512-44-8890."),
            ("caller", "Last step, install AnyDesk so I can secure your laptop. Stay on the line, and don't tell anyone, this is urgent."),
        ],
    },
    "bank-fraud": {
        "title": "Bank fraud department impersonation",
        "threat_type": "Vishing — bank impersonation / funds redirect",
        "caller": {"display_name": "Chase Fraud Dept", "number": "+1 (212) 555-0101",
                   "carrier_route": "International VoIP relay", "location": "Unknown (VoIP)",
                   "attestation": "C", "voip_origin": True, "spoofed_brand": True, "first_contact": True},
        "subscriber": "Marcus Okafor",
        "environment": {},
        "lines": [
            ("caller", "Good afternoon, am I speaking with Marcus Okafor? This is the fraud department from Chase."),
            ("subscriber", "Yes, speaking."),
            ("caller", "We've flagged a wire transfer of nine thousand dollars from your account ending in 4421. Did you authorize it?"),
            ("subscriber", "No, I definitely did not."),
            ("caller", "Your account will be frozen immediately unless we move your funds to a safe account. Let me walk you through it."),
            ("caller", "Read me the code 739204 and we'll transfer the money through Zelle. Please don't hang up."),
        ],
    },
    "sim-swap": {
        "title": "Carrier support · eSIM port-out",
        "threat_type": "SIM swap — social-engineered eSIM transfer",
        "caller": {"display_name": "Carrier Support", "number": "+1 (646) 555-0177",
                   "carrier_route": "Wholesale VoIP gateway · SIP trunk", "location": "Unknown (VoIP)",
                   "attestation": "B", "voip_origin": True, "spoofed_brand": True, "first_contact": True},
        "subscriber": "Priya Patel",
        "environment": {"port_out_pending": True},
        "lines": [
            ("caller", "Hello Priya Patel, this is carrier support. Your line is scheduled for a mandatory eSIM upgrade."),
            ("subscriber", "I didn't request an upgrade."),
            ("caller", "It's required, otherwise your service will be suspended within the next hour."),
            ("caller", "To transfer your number to the new eSIM I need the transfer PIN we just texted, it's PIN 5521."),
            ("caller", "And confirm the email on the account, priya.patel@example.com. Don't hang up or the port-out will fail."),
        ],
    },
}


def build_call(scenario_id: str) -> dict:
    sc = CALL_SCENARIOS[scenario_id]
    meta = sc["caller"]
    sanitized_lines, raw_lines = [], []
    for speaker, text in sc["lines"]:
        tok = tokenize(text)
        sanitized_lines.append({"speaker": speaker, "text": tok["text"], "entities": tok["counts"]})
        raw_lines.append({"speaker": speaker, "text": text})
    caller_side = [l["text"] if l["speaker"] == "caller" else "" for l in sanitized_lines]
    scoring = risk.score_transcript(caller_side, meta)

    t, fired, lines = 2600, set(), []
    for i, (raw, san) in enumerate(zip(raw_lines, sanitized_lines)):
        score = scoring["progression"][i]
        triggers = []
        for threshold, key, label, detail in INTERVENTIONS:
            if score >= threshold and key not in fired:
                fired.add(key)
                triggers.append({"key": key, "label": label, "detail": detail, "threshold": threshold})
        lines.append({"index": i, "speaker": raw["speaker"], "text": raw["text"],
                      "sanitized_text": san["text"], "entities": san["entities"],
                      "at_ms": t, "risk_after": score, "signals": [s["label"] for s in risk.signals_in(san["text"])],
                      "interventions": triggers})
        t += 900 + len(raw["text"]) * 58

    base_score, factors = risk.metadata_score(meta)
    return {
        "scenario_id": scenario_id, "title": sc["title"], "threat_type": sc["threat_type"],
        "synthetic": True,
        "caller": {**{k: meta[k] for k in ("display_name", "number", "carrier_route", "location", "attestation")},
                   "number_token": make_token("PHONE", meta["number"])},
        "subscriber_token": make_token("PERSON", sc["subscriber"]),
        "initial_risk": base_score, "metadata_factors": factors,
        "final_risk": scoring["score"], "severity": scoring["severity"], "signals": scoring["signals"],
        "lines": lines, "duration_ms": t,
    }


def list_scenarios() -> list[dict]:
    return [{"id": k, "title": v["title"], "threat_type": v["threat_type"],
             "caller": v["caller"]["display_name"]} for k, v in CALL_SCENARIOS.items()]


# ── Network telemetry ───────────────────────────────────────────────────────

EVENT_TYPES = {
    "SIM_SWAP_REQUEST": ("SIM swap request", "sim", (62, 95),
                         "Require in-store ID verification and hold the swap for 24h."),
    "PORT_OUT_REQUEST": ("Port-out request", "sim", (55, 92),
                         "Enforce port-out PIN and notify subscriber on a second channel."),
    "IMEI_CHANGE": ("Device (IMEI) change", "sim", (30, 70),
                    "Correlate with recent SIM activity before allowing high-value transactions."),
    "VOIP_SPOOF": ("Spoofed VoIP call", "voice", (45, 90),
                   "Label as suspected spam and enable carrier call shield."),
    "ROBOCALL_BURST": ("Robocall burst", "voice", (20, 60),
                       "Rate-limit originating trunk and add to analytics watchlist."),
    "SMISHING_LINK": ("Smishing link", "sms", (40, 88),
                      "Quarantine message and rewrite URL through safe-browsing proxy."),
    "NETWORK_DOWNGRADE": ("Unauthenticated 2G downgrade", "network", (50, 94),
                          "Disable 2G fallback for the subscriber; possible IMSI catcher nearby."),
    "NORMAL_ATTACH": ("Routine network attach", "network", (2, 18), "No action required."),
}
EVENT_WEIGHTS = [("NORMAL_ATTACH", 30), ("ROBOCALL_BURST", 14), ("VOIP_SPOOF", 14), ("SMISHING_LINK", 12),
                 ("IMEI_CHANGE", 8), ("NETWORK_DOWNGRADE", 7), ("PORT_OUT_REQUEST", 7), ("SIM_SWAP_REQUEST", 8)]
NETWORKS = ["5G SA", "5G NSA", "LTE", "LTE", "VoLTE"]
CELLS = ["SFO-4412", "SFO-4419", "OAK-1180", "SJC-2207", "NYC-0931", "NYC-0954", "AUS-3310", "SEA-7702"]


def generate_event(seq: int) -> dict:
    """Deterministic for a given sequence number, so demos are reproducible."""
    rng = random.Random(seq * 7919 + 17)
    kind = rng.choices([k for k, _ in EVENT_WEIGHTS], weights=[w for _, w in EVENT_WEIGHTS])[0]
    label, channel, (lo, hi), rec = EVENT_TYPES[kind]
    score = rng.randint(lo, hi)
    subscriber = f"+1 415 555 {rng.randint(1000, 1999)}"
    network = "2G GSM (A5/0)" if kind == "NETWORK_DOWNGRADE" else rng.choice(NETWORKS)
    details = {
        "SIM_SWAP_REQUEST": f"Swap requested via {rng.choice(['retail store', 'online portal', 'call center'])}; "
                            f"account age {rng.randint(1, 9)}y",
        "PORT_OUT_REQUEST": f"Port-out to {rng.choice(['MVNO-A', 'MVNO-B', 'Carrier-X'])}; PIN attempts {rng.randint(1, 4)}",
        "IMEI_CHANGE": f"New device TAC {rng.randint(35000000, 35999999)}",
        "VOIP_SPOOF": f"Attestation {rng.choice(['C', 'C', 'B'])}; caller ID mimics {rng.choice(['bank', 'IRS', 'employer IT'])}",
        "ROBOCALL_BURST": f"{rng.randint(120, 4000)} calls/min from one trunk",
        "SMISHING_LINK": f"Lookalike domain {rng.choice(['secure-verify', 'acct-helpdesk', 'pkg-redeliver'])}.top",
        "NETWORK_DOWNGRADE": "Forced fallback with null cipher (A5/0) on non-whitelisted cell",
        "NORMAL_ATTACH": "Authenticated attach (5G-AKA)",
    }[kind]
    return {
        "type": kind, "label": label, "channel": channel, "risk_score": score,
        "severity": risk.severity_for(score), "network": network, "cell_id": rng.choice(CELLS),
        "subscriber_token": make_token("PHONE", subscriber), "details": details,
        "recommendation": rec, "source": "carrier-simulator", "simulated": True,
        "created_at": clock.now(),
    }
