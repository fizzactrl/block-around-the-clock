# Hackathon demo script (≈ 4 minutes)

**Setup:** run `npm run dev`, open http://localhost:5173 in Chrome, and turn the sound on. If a previous run was left mid-story, click **Reset story** in the **Demo story** tracker (bottom right). The tracker ticks off the 8 steps as you go.

---

### Opening · Landing page (40s)
Open http://localhost:5173 and **scroll slowly**:
- The headline letters converge.
- The statement lights up word by word.
- "Before. During. After." brighten in turn.
- The Nemotron trace replays a real stored run as you scroll.
- Personal data scrambles into tokens.
- The proof numbers count up.

Optionally flip the hero's **Simulate breach** switch. Then click **Enter the command center**.

### 0 · Command Center (20s)
> "Block Around the Clock is a carrier-native defense gateway. Before, during and after a social-engineering attack, we act at the network layer, where the attacker actually operates."

- Point at **Protected**, the 24-hour threat chart, and **Audit chain intact**.
- Click **Simulate suspicious call**.

### 1–3 · Live Call Defense (75s)
> "A call arrives from 'IT Service Desk'. STIR/SHAKEN attestation is C, it comes through a wholesale VoIP gateway, and it's a first contact. Risk starts at 25 before anyone says a word."

1. Select **Fake IT helpdesk**, then click **Simulate incoming call** and **Accept** on the phone.
2. As the caller speaks, signals light up: impersonation, urgency, then a request for a one-time code.
3. **Risk ≥ 45:** audio ducking engages. The waveform dims and shows *−12 dB*.
4. **Risk ≥ 65:** the **security whisper** plays a chime, then a private voice warning that the caller can't hear.
5. **Risk ≥ 85:** the **flash alert** takes over the phone. Click **Dismiss** to let the script finish.
- Toggle **Raw · synthetic / Tokenized** on the transcript.
> "The SSN, phone number and one-time code were tokenized in the browser. The raw values never leave this device."

Click **Escalate to war room**.

*Be honest with judges: in production this happens inside the carrier's voice core. Here, Web Audio and Web Speech simulate the experience.*

### 4 · Privacy Sieve (optional, 30s)
- Open **Privacy Sieve** to show raw and tokenized text side by side and the "removed before cloud AI" count.
- Click **Validate on server**: the result is *0 residual*.
- Click **Send raw (bypass test)**: the server catches the leak anyway (defense in depth).

### 5–7 · Incident War Room: the Nemotron agent (90s)
> "Containment is handled by an agent built on NVIDIA Nemotron. It has eight containment tools. It calls one at a time and reads each result before deciding the next step."

1. Point at **Simulated environment: Sustained TransUnion API outage**. "The agent doesn't know this. It has to discover it."
2. Choose **Nemotron 3.5 Lightning** and click **Engage Nemotron agent**.
3. Narrate the trace as it streams:
   - **Assessment:** severity, threat summary and prioritised objectives.
   - **Tool calls:** each with Nemotron's rationale, executed by a validated Flask adapter. Each **observation** shows the real result code.
   - **The failure:** `freeze_credit(transunion)` → `BUREAU_UNAVAILABLE`. "That result went back to Nemotron as a tool message."
   - **The replan** (orange **Replan** badge): Nemotron switches strategy, for example to a fraud alert at a healthy bureau that propagates to all three. Or it escalates with `request_human_intervention`, explaining exactly what's blocked.
4. Point at the stats: model turns, tool calls, **replans**, tokens and model time.
5. If it escalated, use the human override: **Fraud alert via Equifax (all bureaus)**. The incident becomes **Contained**.
> "The model proposes and acts only through allowlisted tools. Policy blocks retry loops, and a server guard won't let it claim success while failures remain."

### Agent Evaluation (60s)
- Open **Agent Evaluation** and click **Run all scenarios**. Or run **eSIM hijack · dependent failure** alone (~30s).
- Show the graded checks, especially *Observed PORT_OUT_IN_PROGRESS → corrective block_port_out → SIM lock recovered*.
- Click **Trace** to show the replan step. Mention that Ultra 550B can be selected and sometimes chooses human escalation, which also passes. The graders check behaviour, not a script.

### 8 · Legal & Forensics (30s)
- Click **Generate report**. Walk through the draft:
  - confirmed vs simulated vs unverified facts
  - the timeline
  - evidence hashes
  - the FTC identity-theft draft, with consumer fields left blank
  - the regulatory scope summary for counsel
- Click **Export PDF**.
> "Everything is a draft that requires human review. We never claim to have filed anything."

The Demo story tracker now reads **8/8**.

---

## Backup plan
- **No audio** (e.g. a projector with no sound): captions and visuals carry the demo. Use the speaker toggle to mute.
- **NVIDIA API slow or down:** the run shows *Agent error* honestly, with no fake output. Click **Run agent again**. Lightning averages ~1–3s per turn.
- **Backend down:** every page shows a "Gateway unreachable" state with a retry button. Restart with `npm run dev`.
- **Need a fresh database:** restart the backend (in-memory mode), or run `npm run seed` (MongoDB mode, wipes and re-seeds).
- **Want a different story:** use the **Bank fraud** (funds redirect / Zelle) or **eSIM port-out** (SIM swap) scenario.
