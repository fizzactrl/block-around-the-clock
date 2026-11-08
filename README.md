# Block Around the Clock

**Autonomous carrier defense gateway and incident response war room, powered by an NVIDIA Nemotron tool-calling agent.**

> **NVIDIA Nemotron Prize Track: "Use Nemotron beyond a chatbot."** Nemotron runs a real multi-step agent loop:
> 1. **Assess** a sanitized incident.
> 2. **Select** an allowlisted containment tool.
> 3. The tool **executes** through a validated Flask adapter.
> 4. The adapter's real success or failure is **observed** and fed back to Nemotron.
> 5. Nemotron **replans** and chooses the next action.
> 6. The loop repeats until containment is complete or a human is needed.
> 7. Every decision, tool call, observation and replan appears live in the war room and in the final report.
>
> An **evaluation mode** grades the agent's behaviour on four reproducible scenarios, including failed actions that force replanning. There is no mock fallback: without `NVIDIA_API_KEY` the agent refuses to run.

Block Around the Clock protects subscribers from vishing, smishing, fake IT-helpdesk calls, SIM-swap attempts and credential compromise across the full attack lifecycle:

| Phase | Module | What it does |
|---|---|---|
| — | Landing (`/`) | Cinematic scroll story: headlines that converge, words that light up as you scroll, the Before/During/After sequence, a live Nemotron trace replay, PII scrambling into tokens, and stats that count up. |
| **Before** | Proactive Defense | Scores simulated carrier telemetry (SIM swaps, port-outs, spoofed VoIP, 2G downgrades) and recommends protections. |
| **During** | Live Call Defense | Interactive call simulator: real-time risk scoring, audio ducking, a private security whisper and a flash alert. |
| **After** | Incident War Room | **Nemotron containment agent:** a live trace of the decide → tool call → observe → replan loop over simulated SIM-lock, credit-freeze and session-revocation adapters, plus manual human overrides. |
| Nemotron | Agent Evaluation | Four scenarios (clean run, dependent failure, sustained outage, low-risk proportionality) graded on the recorded trace. |
| Trust | Privacy Sieve | Tokenizes PII in the browser before anything leaves the device, then re-validates it on the server. |
| Trust | Legal & Forensics | Draft incident report, FTC identity-theft draft, regulatory scope summary and PDF export. |

> **What is simulated.** Carrier signalling, call audio, telemetry and every containment adapter are **simulated** and labelled as such in the UI. Nothing contacts a real carrier, bank, identity provider or credit bureau. Browser audio APIs cannot modify real calls or send real Class 0 SMS. Reports are **drafts for human review**: nothing is filed. The audit hash chain provides **tamper evidence**, not immutable storage.

---

## Quick start

Prerequisites: **Node 20+** and **Python 3.11+**. MongoDB is optional.

```bash
npm run dev          # creates the venv, installs dependencies, starts both servers
# → open http://localhost:5173 (landing) · console at /command
```

To start them separately:

```bash
# Backend (Flask, port 5050)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python run.py

# Frontend (Vite, port 5173; proxies /api to :5050)
cd frontend
npm install
npm run dev
```

On first start the backend seeds 24 hours of synthetic telemetry and three resolved incidents.

### Tests

```bash
npm test             # pytest (backend) + vitest (frontend) + typecheck + production build
```

The backend smoke tests run the full demo story end to end:

- call → incident → AI analysis → containment
- the deterministic adapter failure and its retry
- report and PDF generation
- audit-chain tamper detection
- policy rejection of non-allowlisted AI actions
- a scan of every collection for raw PII

---

## Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. **Empty** = built-in in-memory store (mongomock), which uses the same pymongo API. |
| `MONGODB_DB` | Database name (default `block_around_the_clock`). |
| `NVIDIA_API_KEY` | Enables **NVIDIA Nemotron** through the NVIDIA API catalog. **Empty** = clearly labelled deterministic demo commander. |
| `NEMOTRON_MODEL` | Default agent model, `nvidia/nemotron-3.5-lightning-30b-a3b` (fast). `nvidia/nemotron-3-ultra-550b-a55b` can be selected per run. |
| `TOKENIZATION_SECRET` | HMAC key for deterministic tokens. Set a long random value. |
| `CONTAINMENT_STEP_SECONDS` | Pacing of simulated containment steps (default 1.6s). |
| `SIMULATE_ADAPTER_FAILURE` | `true`: incidents with no scenario-specific environment get a transient TransUnion error on the first attempt. |
| `SEED_ON_START` | Seed demo data when the database is empty. |

Secrets live only in the backend. The frontend never sees an API key.

To reset the demo data in MongoDB mode (this wipes all four collections): `npm run seed`. In in-memory mode, restarting the backend resets everything.

---

## API

All responses use the envelope `{ "ok": true, "data": … }` or `{ "ok": false, "error": { code, message, details } }`. The API uses status codes 200, 201, 202, 404, 409, 422 and 500.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Status, database mode, AI engine |
| GET | `/api/dashboard` | Command-center aggregates |
| POST | `/api/simulate-call` | `{scenario_id}` → synthetic call script with risk progression and interventions |
| POST | `/api/tokenize` | `{text, client_tokenized}` → server-side validation (defense in depth) |
| POST | `/api/trigger-incident` | Create an incident from an **edge-tokenized** transcript |
| POST | `/api/analyze-threat` | `{incident_id}` → AI commander (Nemotron or demo); schema and allowlist enforced |
| GET | `/api/incident-status/:id` | Advances the state machine and returns incident, actions and progress |
| POST | `/api/incidents/:id/contain` | Authorize the AI plan (`{approved?: [...]}`) |
| POST | `/api/incidents/:id/actions` | Manual emergency action (policy-validated) |
| POST | `/api/incidents/:id/actions/:aid/retry` | Retry a failed action |
| GET | `/api/incidents/:id/timeline` | Hash-chained audit events |
| POST | `/api/incidents/:id/agent` | **Engage the Nemotron agent** (`{model?}`). Runs asynchronously; poll status. |
| GET | `/api/incidents/:id/agent`, `/api/agent-runs/:run_id` | Agent run with full step trace (decisions, tool calls, observations, replans) |
| POST | `/api/agent-runs/:run_id/stop` | Operator stop (takes effect after the current turn) |
| GET / POST | `/api/eval/scenarios`, `/api/eval/run`, `/api/eval/runs[/:id]` | Evaluation mode: scenarios, run one, graded results |
| GET | `/api/legal-report/:id` | Draft legal and forensic report (JSON) |
| GET | `/api/legal-report/:id/pdf` | PDF export |
| GET / POST | `/api/telemetry/events`, `/api/telemetry/simulate` | Carrier telemetry feed and simulator |
| GET | `/api/incidents`, `/api/scenarios`, `/api/policy/actions`, `/api/privacy/policy`, `/api/audit/verify` | Supporting endpoints |

Append `?instant=true` to the containment endpoints to run every step synchronously (used by the tests).

---

## Project layout

```
backend/            Flask API
  app/api.py          routes + pydantic request schemas
  app/services/       tokenizer · risk · simulator · orchestrator · ai_commander · policy · adapters · audit · reports · telemetry · dashboard
  app/seed.py         chronological demo seeding
  tests/              pytest smoke tests
frontend/           React + Vite + TypeScript + Tailwind v4
  src/components/     shadcn-style primitives (ui/) and domain components
  src/lib/            api client, edge tokenizer, Web Audio/Speech engine, demo-story state
  src/pages/          Command Center · Proactive · Live Call · Privacy Sieve · War Room · Reports
shared/privacy-policy.json   single PII policy used by browser and server
docs/               ARCHITECTURE.md · DEMO_SCRIPT.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Nemotron agent at a glance

- **Tools:** `record_assessment`, `lock_sim`, `block_port_out`, `enable_call_shield`, `revoke_sessions(scope)`, `reset_credentials`, `freeze_credit(bureau)`, `place_fraud_alert(bureau)`, `alert_bank_fraud`, `request_human_intervention` and `complete_containment`. They use OpenAI-style function calling on the NVIDIA API.
- **Guardrails:**
  - Every call is validated against the allowlist and its parameter enums before any adapter runs.
  - Identical calls that fail twice are blocked by policy.
  - There is a 16-turn budget.
  - A **server-side completion guard** downgrades "complete" to *attention required* if failures remain uncompensated.
- **Stateful simulated world:** each incident carries visible conditions, such as a port-out already in flight or a sustained bureau outage. The agent is not told about them. It discovers them from tool results and must diagnose and replan.
- **Evaluation:** see the in-app *Agent Evaluation* page or `docs/DEMO_SCRIPT.md`. Results from live runs are recorded in `docs/ARCHITECTURE.md`.

## Deployment notes

- **Backend:** run `gunicorn -w 1 -k gthread --threads 8 'app:create_app()'` from `backend/`. Use a single worker, because the orchestrator lock is in-process. Set `MONGODB_URI` to Atlas or another MongoDB instance and set a real `TOKENIZATION_SECRET`.
- **Frontend:** run `npm run build` and serve `frontend/dist`. Either reverse-proxy `/api` to the backend, or set `VITE_API_BASE` to the backend's URL and add the frontend origin to `CORS_ORIGINS`.
