# Architecture

```
 Browser (React)                                   Flask gateway                          Storage / AI
 ───────────────                                   ─────────────                          ────────────
 Live Call simulator ──► Web Audio (ducking, chime, line bed)
                    └──► Web Speech (caller voice, whisper)
 Edge tokenizer (HMAC, WebCrypto) ──tokens only──► /trigger-incident ─► server re-scan ─► MongoDB (sanitized only)
                                                    /analyze-threat  ─► AI commander  ─► NVIDIA Nemotron (sanitized JSON)
                                                                         │                 or deterministic demo engine
                                                                         ▼
                                                    policy.enforce (pydantic schema + allowlist)
                                                                         ▼
                                                    orchestrator state machine ─► simulated adapters
                                                                         ▼
                                                    audit.append (SHA-256 hash chain) ─► audit_logs
                                                    reports.build / reports.pdf
```

## Privacy pipeline (defense in depth)

1. **Shared policy.** [`shared/privacy-policy.json`](../shared/privacy-policy.json) defines the detectors (card with a Luhn check, SSN, phone, email, account number, OTP/PIN, a bank dictionary, and demo name patterns). The regex sources work in both JavaScript and Python.
2. **Edge.** `frontend/src/lib/tokenizer.ts` replaces values with `[TYPE_XXXXXX]` tokens. Each token is HMAC-SHA-256 under a per-session key held only in memory. Only the tokenized transcript is sent to the gateway.
3. **Server.** `orchestrator.create_incident` and `ai_commander.analyze` both call `sanitize_tree`, which re-scans every string. Any residual value is tokenized with the server's secret and recorded in the audit log as `privacy.residual_tokenized`.
4. **No reverse maps.** Tokens are one-way. The database stores only tokens and category counts. A test scans every collection for raw PII.

## Nemotron containment agent (`backend/app/services/agent.py`)

```
 sanitized incident ─► Nemotron (tools=…) ─► tool_call ─► policy.validate_action ─► stateful simulated adapter
        ▲                                                                                   │
        └──────── role:"tool" message {ok, code, message, reference} ◄──── observation ────┘
```

- **Client.** Calls `POST {NVIDIA_BASE_URL}/chat/completions` with `tools` and `tool_choice:"auto"`. Transient 429 and 5xx errors are retried twice. Otherwise the run ends in `ERROR` and the UI shows it; **no mock is substituted**. Tests use a scripted model stand-in that only the test suite can inject.
- **Loop.**
  1. `record_assessment` must come first.
  2. Each containment tool call is validated, executed and persisted as a `containment_actions` document.
  3. The observation goes back to the model as a `role:"tool"` message.
  4. A tool call made right after a failure is flagged `replan` and audit-logged as `agent.replan`.
  5. The run ends on `complete_containment`, `request_human_intervention`, operator stop or the turn budget.
- **Guards.**
  - The allowlist and parameter enums are checked on every call.
  - Policy blocks a third identical call after two failures.
  - The completion guard (`unresolved_failures`) treats a failed freeze or fraud alert as compensated only when a fraud alert succeeded at another bureau.
- **Simulated environment** (`adapters.py`). It is stateful per incident:
  - `port_out_pending` makes `LOCK_SIM` fail with `PORT_OUT_IN_PROGRESS` until `BLOCK_PORT_OUT` cancels the port.
  - `bureau_outage` makes freezes and alerts at that bureau fail with `BUREAU_UNAVAILABLE` (sustained).
  - Re-applying a control returns `NO_OP`.
  - Conditions are shown in the war room and the report. The model is not told about them.
- **Persistence.** The `agent_runs` collection holds the model, the served model, every step (reasoning excerpt, latency, tokens, tool calls, observations), usage totals, the outcome and any error. The `eval_runs` collection holds graded evaluations.

### Evaluation results (live NVIDIA API, Nemotron 3.5 Lightning, 2026-11-08)

| Scenario | What Nemotron did | Verdict |
|---|---|---|
| Credential theft · clean | Assessed, locked SIM, blocked port-out, revoked sessions, reset credentials, froze all 3 bureaus, completed | PASS 6/6 |
| eSIM hijack · dependent failure | `lock_sim` → `PORT_OUT_IN_PROGRESS` → **replan** `block_port_out` → `lock_sim` succeeds → completed | PASS 6/6 |
| Bureau outage · forced replanning | Froze Equifax and Experian. TransUnion freeze → `BUREAU_UNAVAILABLE` → **replan** to a TransUnion fraud alert (also fails) → fraud alert at Equifax (propagates to all three) → completed. *Ultra 550B instead escalated to a human; both strategies pass.* | PASS 6/6 |
| Nuisance robocall | Assessed *low*; only `enable_call_shield`; completed | PASS 5/5 |

The model is not deterministic, so individual runs can choose different but valid strategies. The graders check behaviour, not a fixed action sequence.

## AI commander and execution policy

- With `NVIDIA_API_KEY` set, the commander POSTs to `{NVIDIA_BASE_URL}/chat/completions` with the configured Nemotron model. The system prompt pins the output to a JSON schema and the action allowlist. Any `<think>` blocks are stripped, then the response is parsed.
- The one-shot `/api/analyze-threat` commander is kept for API compatibility and seeded history. When a key is configured, it **never** falls back silently: a failed call returns HTTP 502. The deterministic rules engine runs only when no key is set, or for seed data, and is labelled as such.
- `policy.enforce` validates the decision with pydantic, then filters each proposed action against the `ACTIONS` allowlist, including parameter enums. Non-allowlisted, malformed or duplicate actions are rejected and audit-logged.
- Policy runs again when an action is queued. Manual actions go through the same `validate_action` check. The model never executes anything: a human authorizes containment.

## Orchestration state machine

```
Incident:  DETECTED ─analyze─► ANALYZED ─authorize─► CONTAINING ─► CONTAINED
                                                         └──────► ATTENTION_REQUIRED ─retry─► CONTAINING
Action:    QUEUED ─► EXECUTING ─► SUCCEEDED | FAILED ─retry─► QUEUED
```

Actions are scheduled on a timeline, spaced `CONTAINMENT_STEP_SECONDS` apart. They advance **lazily** whenever their state is read (`advance()`), under an in-process lock. This keeps the engine deterministic, restart-safe and easy to test with `instant=True`, and avoids background workers. Adapters are deterministic. One adapter (TransUnion) fails on its first attempt when `SIMULATE_ADAPTER_FAILURE=true`.

## Data model (MongoDB)

| Collection | Contents |
|---|---|
| `incidents` | ID, status, severity, risk score, signals, sanitized transcript, privacy ledger (counts only), AI analysis (sanitized context sent, decision, policy report), timestamps |
| `sanitized_events` | Telemetry events and call records, with subscriber identities tokenized |
| `containment_actions` | Action, params, status, attempts, schedule, simulated result reference |
| `audit_logs` | Append-only. Each entry stores `seq`, `ts`, `event_type`, `summary`, `actor`, `incident_id`, `data`, `prev_hash` and `hash` |

**Hash chain:** `hash = SHA256(prev_hash + canonical_json(entry))`. `GET /api/audit/verify` recomputes the whole chain and reports the first broken `seq`. Timestamps are millisecond-precision ISO strings, so hashes survive a MongoDB round-trip unchanged. This is tamper evidence for the demo. A database administrator could still rewrite the whole chain.

When `MONGODB_URI` is empty or unreachable, `db.init_db` falls back to **mongomock**. It has the same API, so no code path changes.

## Frontend

- **Design system:** Tailwind v4 `@theme` tokens in `src/index.css`: neutral surfaces, one accent, a semantic severity scale, and night surfaces for the phone and war room. The primitives are shadcn-style (Radix + CVA), with Inter Variable, Motion for transitions and microinteractions, and Lucide icons.
- **Charts:** Recharts. Threat activity uses a validated single-hue ordinal ramp for severity, with a legend and hover tooltips.
- **Demo story:** `lib/demo.tsx` tracks the eight-step narrative across pages. It derives later steps from live incident state.
- **Audio:** `lib/audio.ts` synthesizes the line bed, ringtone, ducking ramp (−12 dB), whisper chime and alarm with Web Audio, and voices lines with Web Speech. Each feature degrades to captions or visuals if its API is unsupported.
