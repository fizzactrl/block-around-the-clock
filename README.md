# Block Around the Clock

**A phone-carrier security system that spots scam calls while they're happening and uses an NVIDIA Nemotron AI agent to lock down a victim's accounts afterward.**

Built for HackUTD · NVIDIA "Use Nemotron Beyond a Chatbot" track

---

## Inspiration

Phone scams usually follow the same pattern. Someone calls pretending to be your bank or your company's IT desk, sounds convincing, and talks you into reading out a one-time code or a password. Within minutes they have moved your phone number to their own SIM card (a "SIM swap"). Every text-message login code now goes to them, and they start opening credit cards and draining accounts in your name.

Phone carriers sit in the middle of all of this. They see the suspicious call come in, they see the SIM-swap request, and they see the strange network activity first. Yet the usual response is still a victim calling a hotline hours later, then phoning their bank, three credit bureaus and their employer one by one.

We wanted to know what it would look like if the carrier could **warn you during the call** and then **clean up automatically** if the scam got through.

## What it does

Block Around the Clock covers the three stages of an attack: **before**, **during** and **after**.

| Stage | Screen | What you see |
|---|---|---|
| **Before** | Proactive Defense | A live feed of carrier events (SIM swaps, number transfers, spoofed calls, suspicious network downgrades). Each one gets a risk score from 0 to 100. Risky events can be turned into an incident with one click. |
| **During** | Live Call Defense | A simulated scam call plays out line by line. As the risk rises, the system responds in steps: it lowers the call volume, then whispers a private warning to the user, then shows a full-screen alert. |
| **After** | Incident War Room | The **Nemotron agent** takes over. It decides what to lock down (the SIM card, number transfers, logins, credit files, the bank), carries out each action, checks whether it worked, and changes its plan when something fails. Every step appears on screen as it happens. |

Supporting tools:

- **Privacy Sieve.** Names, phone numbers, card numbers and similar details are replaced with tokens like `[PHONE_3F9A21]` **in the browser**, before anything is sent to our server or the AI. The AI never sees real personal data.
- **Agent Evaluation.** Runs the AI agent through four test scenarios and grades how it behaved, including cases where tools fail on purpose.
- **Reports.** Produces a draft incident report and an FTC identity-theft report, both exportable as a PDF.
- **Audit log.** Every action is recorded in a hash-chained log, so if anyone edits an old entry it can be detected.

### Why this is more than a chatbot

Nemotron doesn't just write a summary. It runs a loop:

1. **Assess** the incident.
2. **Choose** an action, for example `lock_sim` or `freeze_credit(Equifax)`.
3. Our server **checks** that the action is allowed, then **runs** it.
4. The real result, success or failure, is **sent back** to Nemotron.
5. Nemotron **replans**. It might retry, try a different action, or ask a human for help.
6. This repeats until the account is secure or a person needs to step in.

For example, if a credit bureau is "down", the agent sees the failure and places a fraud alert instead. It doesn't pretend the freeze worked. If a number transfer is already in progress, it blocks that first. If the call was only a harmless robocall, it should do very little. Our evaluation checks all of these.

> **What's simulated.** This is a hackathon demo. The carrier network, call audio, telemetry and every lockdown action (SIM lock, credit freeze, bank alert) are **simulated** and labelled that way in the app. Nothing contacts a real carrier, bank or credit bureau. Reports are drafts for a human to review; nothing is filed. The AI calls, however, are **real**: the agent runs on the live NVIDIA Nemotron API, with no fake fallback.

## How we built it

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn-style components, Motion (animations), Recharts (charts), Lucide (icons), Lenis (smooth scrolling)
- **Backend:** Python, Flask, pydantic (input validation), ReportLab (PDF reports)
- **AI:** NVIDIA Nemotron through the NVIDIA API catalog, using tool calling. The default model is `nemotron-3.5-lightning-30b-a3b`; `nemotron-3-ultra-550b-a55b` is available for harder cases.
- **Database:** MongoDB Atlas. The app falls back to an in-memory database when no connection string is set, so anyone can run it.
- **Privacy:** One shared rule file (`shared/privacy-policy.json`) is used by both the browser and the server, so both remove personal data the same way.
- **Testing:** pytest (backend), Vitest (frontend)

Under the hood, each lockdown action is a small simulated "adapter" with its own state. A credit bureau can be down for one attempt or for good, and a number transfer can already be underway. The agent isn't told about these conditions. It has to discover them from the results it gets back, like it would in the real world.

## Challenges we ran into

- **The AI skipped steps.** In early runs Nemotron sometimes didn't freeze credit at all, so our "credit bureau is down" test never triggered. We fixed this by giving it a clear identity-protection policy: freeze all three bureaus, and use a fraud alert only as a backup.
- **Grading fairly.** Our grader first marked a run as failed whenever *any* action failed, even when the agent had correctly worked around it. We rewrote it to track which failures were actually still unresolved.
- **Stopping the AI from claiming success too early.** We added a server-side check: if the agent says "done" while a failure is still unresolved, the incident is marked *needs attention* instead of *contained*.
- **Our privacy filter was too good.** Incident IDs like `INC-261108-4421` looked like phone numbers, so they were being hidden. We changed the ID format so it no longer matches.
- **Database connection errors.** MongoDB Atlas rejected connections on macOS because of missing security certificates. We fixed it by bundling the `certifi` certificates.
- **No silent fakes.** It would have been easy to quietly return a pre-written answer whenever the AI call failed. We decided not to: if Nemotron isn't available, the agent says so plainly.

## Accomplishments that we're proud of

- A **working AI agent loop** on the live Nemotron API, not a scripted demo. On our last live evaluation run it passed **23 out of 23** checks across all four scenarios.
- The agent **recovers from failures** on its own and explains why it changed its plan.
- **Personal data never reaches the server or the AI.** A test scans every database collection to prove no raw personal data was stored.
- A **tamper-evident audit log**: change one old entry and verification fails.
- A full **before → during → after** story you can click through in a few minutes, with a landing page we're proud of.

## What we learned

- How to build a real **tool-calling agent**: designing tools, validating every call, setting limits (16 turns maximum, no repeating the same failed action), and feeding real results back to the model.
- Clear **written rules in the prompt** change an agent's behaviour more than clever wording does.
- How to **evaluate an AI agent** by grading what it actually did, step by step, not just its final message.
- Privacy works best when it happens **as early as possible**, which in our case means in the browser.
- How phone scams really work: SIM swaps, number transfers, caller-ID spoofing and network downgrade attacks.

## What's next for Block Around the Clock

- **Deploy it** at [blockaroundtheclock.fishing](https://blockaroundtheclock.fishing).
- **Connect to real systems** through carrier, bank and credit-bureau partner APIs, replacing the simulated adapters.
- **Real call analysis** that works on actual call audio, not scripted transcripts.
- **More evaluation scenarios**, such as several attacks at once, partial outages and attempts to manipulate the agent.
- **Human review workflows**, so security teams can approve or reject the agent's riskier actions from their phones.

---

## Try it yourself

You'll need **Node.js 20+** and **Python 3.11+**.

```bash
git clone https://github.com/fizzactrl/block-around-the-clock.git
cd block-around-the-clock
npm run dev
```

Then open **http://localhost:5173**. This one command sets up Python, installs everything and starts both the website and the server. The first start loads sample data automatically.

### Turning on the AI agent

1. Get a free API key from [build.nvidia.com](https://build.nvidia.com).
2. Open `backend/.env` (created on first run from `backend/.env.example`).
3. Set `NVIDIA_API_KEY=your-key`.
4. Optional: set `MONGODB_URI` to your MongoDB Atlas connection string. Without it, data is kept in memory and resets on every restart.
5. Restart with `npm run dev`.

Without a key, the app still runs, but the Nemotron agent and evaluation are switched off and clearly say so.

**Never commit `backend/.env`.** It's already excluded by `.gitignore`.

### Running the tests

```bash
npm test
```

This runs the backend tests, the frontend tests, a type check and a production build.

<details>
<summary><strong>All settings (<code>backend/.env</code>)</strong></summary>

| Setting | What it does |
|---|---|
| `NVIDIA_API_KEY` | Turns on the Nemotron agent. |
| `NEMOTRON_MODEL` | Default model (`nvidia/nemotron-3.5-lightning-30b-a3b`). |
| `MONGODB_URI` | MongoDB connection string. Leave empty for the in-memory database. |
| `MONGODB_DB` | Database name (default `block_around_the_clock`). |
| `TOKENIZATION_SECRET` | Secret used to create privacy tokens. Use a long random value. |
| `CONTAINMENT_STEP_SECONDS` | Delay between simulated lockdown steps (default 1.6s). |
| `SIMULATE_ADAPTER_FAILURE` | Makes one action fail on its first try, to show failure handling. |
| `SEED_ON_START` | Loads sample data when the database is empty. |
| `CORS_ORIGINS` | Website addresses allowed to call the API. |

</details>

<details>
<summary><strong>Project layout</strong></summary>

```
backend/                 Flask API
  app/api.py               all API routes
  app/services/agent.py    the Nemotron agent loop
  app/services/evaluation.py  the four test scenarios and grader
  app/services/            privacy tokens, risk scoring, adapters, audit log, reports
  tests/                   backend tests
frontend/                React website
  src/pages/               one file per screen
  src/components/          shared building blocks
  src/lib/                 API client, in-browser privacy filter
shared/privacy-policy.json   privacy rules shared by browser and server
docs/                    architecture notes and demo script
```

</details>

<details>
<summary><strong>Main API endpoints</strong></summary>

Every response looks like `{ "ok": true, "data": … }` or `{ "ok": false, "error": { … } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Server, database and AI status |
| POST | `/api/simulate-call` | Run a simulated scam call |
| POST | `/api/trigger-incident` | Open an incident from a privacy-filtered transcript |
| POST | `/api/incidents/:id/agent` | Start the Nemotron agent |
| GET | `/api/agent-runs/:run_id` | Watch the agent's step-by-step trace |
| POST | `/api/eval/run` | Run an evaluation scenario |
| GET | `/api/legal-report/:id/pdf` | Download the incident report as a PDF |
| GET | `/api/audit/verify` | Check the audit log hasn't been tampered with |

For how the pieces fit together, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For a walkthrough of the demo, see [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

</details>

## Team

- **Fizza** · [@fizzactrl](https://github.com/fizzactrl)
- **Kartikay** · [@gokartikay11](https://github.com/gokartikay11)
