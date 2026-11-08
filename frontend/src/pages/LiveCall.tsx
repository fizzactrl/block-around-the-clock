import { AnimatePresence, motion } from "motion/react";
import {
  AlertOctagon, ArrowRight, AudioLines, Ear, Info, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, ShieldAlert, Siren,
  Volume2, VolumeX, Zap,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LiveDot, PageHeader, RiskRing, SeverityBadge, SimulatedTag } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { audioEngine, type AudioState } from "@/lib/audio";
import { useDemo } from "@/lib/demo";
import { mergeCounts, privacyPolicy, tokenizeLocal } from "@/lib/tokenizer";
import type { CallLine, CallScript, Scenario } from "@/lib/types";
import { cn, mmss, sleep } from "@/lib/utils";

type Phase = "idle" | "ringing" | "active" | "ended";
type InterventionKey = "duck" | "whisper" | "flash";
interface TimelineItem { t: number; label: string; detail?: string; tone: "neutral" | "warn" | "critical" | "ok" }
interface ShownLine extends CallLine { tokenized: string; counts: Record<string, number> }

const WHISPER_TEXT = "Carrier security notice. This caller could not be verified and is asking for sensitive information. " +
  "Do not share codes or your Social Security number. Hang up, and call back using a number you trust.";

export default function LiveCall() {
  const navigate = useNavigate();
  const demo = useDemo();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("it-helpdesk");
  const [script, setScript] = useState<CallScript | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<ShownLine[]>([]);
  const [risk, setRisk] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [applied, setApplied] = useState<Set<InterventionKey>>(new Set());
  const [pending, setPending] = useState<InterventionKey[]>([]);
  const [whisperOn, setWhisperOn] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [autoIntervene, setAutoIntervene] = useState(true);
  const [muted, setMuted] = useState(false);
  const [view, setView] = useState<"raw" | "tokenized">("tokenized");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [audioState, setAudioState] = useState<AudioState>(audioEngine.state);
  const [escalating, setEscalating] = useState(false);
  const [loading, setLoading] = useState(false);
  const runId = useRef(0);
  const startedAt = useRef(0);
  const autoRef = useRef(autoIntervene);
  autoRef.current = autoIntervene;
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { api.scenarios().then(setScenarios).catch(() => undefined); }, []);
  useEffect(() => audioEngine.subscribe(setAudioState), []);
  useEffect(() => () => { runId.current++; audioEngine.hangup(); }, []);
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [lines.length]);
  useEffect(() => {
    if (phase !== "active") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  const log = useCallback((label: string, tone: TimelineItem["tone"] = "neutral", detail?: string) =>
    setTimeline((t) => [...t, { t: startedAt.current ? Date.now() - startedAt.current : 0, label, detail, tone }]), []);

  const applyIntervention = useCallback(async (key: InterventionKey, manual = false) => {
    if (appliedRef.current.has(key) && key !== "whisper") return;
    setApplied((s) => new Set(s).add(key));
    setPending((p) => p.filter((k) => k !== key));
    demo.mark({ intervened: true });
    const by = manual ? "Operator" : "Auto-policy";
    if (key === "duck") {
      audioEngine.duck(true);
      log("Audio ducking engaged", "warn", `${by} · caller audio attenuated to −12 dB`);
    } else if (key === "whisper") {
      audioEngine.duck(true);
      setWhisperOn(true);
      log("Security whisper delivered", "warn", `${by} · private to subscriber, caller cannot hear`);
      await audioEngine.whisper(WHISPER_TEXT);
      if (!audioEngine.state.supported.speech || audioEngine.muted) await sleep(3800);
      setWhisperOn(false);
    } else if (key === "flash") {
      audioEngine.alarm();
      setFlashOn(true);
      log("Flash security alert raised", "critical", `${by} · simulated Class 0-style overlay`);
    }
  }, [demo, log]);

  const runScript = useCallback(async (s: CallScript, id: number) => {
    let prevAt = 0;
    for (const line of s.lines) {
      if (runId.current !== id) return;
      const gap = Math.min(1400, Math.max(500, line.at_ms - prevAt - line.text.length * 58));
      prevAt = line.at_ms;
      await sleep(gap);
      if (runId.current !== id) return;
      const tok = await tokenizeLocal(line.text);
      setLines((l) => [...l, { ...line, tokenized: tok.text, counts: tok.counts }]);
      setRisk(line.risk_after);
      setHistory((h) => [...h, line.risk_after]);
      if (line.risk_after >= 45) demo.mark({ riskDetected: true });
      line.signals.forEach((sig) => log(`Signal · ${sig}`, "neutral", `Risk now ${line.risk_after}`));
      if (tok.total) log(`Edge tokenized ${tok.total} value${tok.total > 1 ? "s" : ""}`, "ok", Object.keys(tok.counts).join(", "));

      const speaking = audioEngine.speak(line.text, line.speaker === "caller" ? "caller" : "subscriber");
      const minDur = sleep(audioEngine.state.supported.speech && !audioEngine.muted ? 0 : 900 + line.text.length * 42);
      await Promise.all([speaking, minDur]);
      if (runId.current !== id) return;

      for (const iv of line.interventions) {
        if (runId.current !== id) return;
        if (autoRef.current) await applyIntervention(iv.key);
        else { setPending((p) => [...p, iv.key]); log(`Recommended: ${iv.label}`, "warn", `Risk crossed ${iv.threshold} · awaiting operator`); }
      }
    }
    if (runId.current === id) log("Caller script finished — awaiting subscriber action", "neutral");
  }, [applyIntervention, demo, log]);

  const resetCall = () => {
    runId.current++;
    audioEngine.hangup();
    setLines([]); setRisk(0); setHistory([]); setApplied(new Set()); setPending([]); setWhisperOn(false); setFlashOn(false);
    setTimeline([]); setElapsed(0); startedAt.current = 0;
  };

  const startCall = async () => {
    resetCall();
    setLoading(true);
    try {
      await audioEngine.unlock();
      const s = await api.simulateCall(scenarioId);
      setScript(s);
      setRisk(s.initial_risk);
      setHistory([s.initial_risk]);
      setPhase("ringing");
      audioEngine.startRinging();
      demo.mark({ callStarted: true, riskDetected: false, intervened: false, incidentId: null });
      setTimeline([{ t: 0, label: "Inbound call signalled", detail: `${s.caller.carrier_route} · attestation ${s.caller.attestation}`, tone: "neutral" },
        ...s.metadata_factors.map((f) => ({ t: 0, label: `Pre-answer · ${f.label}`, detail: `+${f.weight} risk`, tone: "warn" as const }))]);
    } catch (e) { toast.error((e as Error).message); } finally { setLoading(false); }
  };

  const answer = () => {
    if (!script) return;
    audioEngine.stopRinging();
    audioEngine.startLine();
    startedAt.current = Date.now();
    setPhase("active");
    log("Subscriber answered", "neutral");
    runScript(script, ++runId.current);
  };

  const endCall = (reason = "Subscriber ended the call") => {
    runId.current++;
    audioEngine.hangup();
    setWhisperOn(false);
    setFlashOn(false);
    log(reason, "ok");
    setPhase("ended");
  };

  const escalate = async () => {
    if (!script) return;
    setEscalating(true);
    try {
      if (phase === "active" || phase === "ringing") endCall("Call terminated by escalation");
      const source = lines.length ? lines : await Promise.all(script.lines.map(async (l) => {
        const t = await tokenizeLocal(l.text);
        return { ...l, tokenized: t.text, counts: t.counts };
      }));
      const st = await api.triggerIncident({
        source: "call", scenario_id: script.scenario_id, title: script.title, threat_type: script.threat_type,
        sanitized_transcript: source.map((l) => ({ speaker: l.speaker, text: l.tokenized })),
        entities_removed: mergeCounts(...source.map((l) => l.counts)),
        interventions: [...applied], evidence_refs: [script.event_id], edge_tokenized: true, policy_version: privacyPolicy.version,
      });
      demo.mark({ incidentId: st.incident.id });
      toast.success(`Incident ${st.incident.id} opened — sanitized transcript only`);
      navigate(`/war-room/${st.incident.id}`);
    } catch (e) { toast.error((e as Error).message); } finally { setEscalating(false); }
  };

  const toggleMute = () => { const m = !muted; setMuted(m); audioEngine.setMuted(m); };

  return (
    <>
      <PageHeader
        eyebrow={<><span className="text-ink">During</span> · Live Call Defense</>}
        title="Live call protection" highlight="protection"
        description="The simulator scores a suspicious call as it happens. As the risk score rises, the network lowers the caller's volume, plays a private warning to the subscriber, and shows a full-screen alert before a code or SSN is shared."
        actions={<>
          <Tip content={muted ? "Unmute simulated audio" : "Mute simulated audio (captions continue)"}>
            <Button variant="secondary" size="icon" onClick={toggleMute} aria-label="Toggle audio">{muted ? <VolumeX /> : <Volume2 />}</Button>
          </Tip>
          <Button variant="secondary" disabled={!script || escalating} onClick={escalate} loading={escalating}><Siren />Escalate to war room</Button>
        </>}
      />

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-dashed border-line-strong bg-surface/60 px-4 py-3 text-[12.5px] text-muted">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>Browser simulation of carrier-native interventions. In production, ducking and whispers run in the carrier voice core (IMS media server).
          This page uses the Web Audio and Web Speech APIs to demonstrate the experience — it never modifies a real call or sends a real Class 0 SMS.
          {!audioState.supported.speech && " Speech synthesis is unavailable in this browser, so captions are shown instead."}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        {/* ── Phone column ───────────────────────────────────────────── */}
        <div className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          <Card className="p-1.5">
            <div className="grid gap-1">
              {(scenarios.length ? scenarios : [{ id: "it-helpdesk", title: "Fake IT helpdesk · credential reset", threat_type: "", caller: "" }]).map((s) => (
                <button key={s.id} onClick={() => phase !== "active" && phase !== "ringing" && setScenarioId(s.id)}
                  disabled={phase === "active" || phase === "ringing"}
                  className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-not-allowed",
                    scenarioId === s.id ? "bg-subtle" : "hover:bg-subtle/60")}>
                  <span className={cn("size-3.5 rounded-full border-[1.5px]", scenarioId === s.id ? "border-accent bg-accent shadow-[inset_0_0_0_2.5px_#0c0f0d]" : "border-line-strong")} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{s.title}</div>
                    <div className="truncate text-[11.5px] text-muted">{s.threat_type}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <PhoneDevice phase={phase} script={script} elapsed={elapsed} ducked={audioState.ducked} speaking={audioState.speaking}
            whisperOn={whisperOn} flashOn={flashOn} lastLine={lines[lines.length - 1]}
            onAnswer={answer} onDecline={() => endCall("Subscriber declined the call")} onHangup={() => endCall()} onDismissFlash={() => setFlashOn(false)} />

          {phase === "idle" || phase === "ended" ? (
            <Button size="lg" className="w-full" onClick={startCall} loading={loading}>
              <PhoneIncoming />{phase === "ended" ? "Simulate another call" : "Simulate incoming call"}
            </Button>
          ) : (
            <Button size="lg" variant="danger" className="w-full" onClick={() => endCall()}><PhoneOff />End call</Button>
          )}
        </div>

        {/* ── Intelligence column ────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 2xl:grid-cols-[1.1fr_1fr]">
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="eyebrow mb-1.5">Live risk</div>
                  <div className="text-[15px] font-semibold">{script ? script.caller.display_name : "Waiting for a call"}</div>
                  <div className="mt-0.5 text-[12.5px] text-muted">{script ? <>Caller <span className="token-chip">{script.caller.number_token}</span></> : "Select a scenario and simulate a call"}</div>
                </div>
                {script && <SeverityBadge severity={risk >= 85 ? "critical" : risk >= 65 ? "high" : risk >= 45 ? "medium" : "low"} />}
              </div>
              <div className="mt-5 flex items-center gap-6">
                <RiskRing value={risk} size={128} stroke={10} />
                <div className="min-w-0 flex-1">
                  <Sparkline values={history} />
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:min-w-[240px]">
                    {([["duck", 45, "Duck"], ["whisper", 65, "Whisper"], ["flash", 85, "Flash"]] as const).map(([k, th, label]) => (
                      <div key={k} className={cn("rounded-lg border px-2 py-1.5 transition",
                        applied.has(k) ? "border-accent bg-accent text-on-ink" : pending.includes(k) ? "border-high bg-high-soft text-[#ffb37a]" : "border-line text-muted")}>
                        <div className="text-[11.5px] font-medium">{label}</div>
                        <div className="text-[10.5px] opacity-70 tnum">≥ {th}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="flex flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="eyebrow">Escalation controls</div>
                <label className="flex items-center gap-2 whitespace-nowrap text-[12px] font-medium text-ink-2">Auto-intervene
                  <Switch checked={autoIntervene} onCheckedChange={setAutoIntervene} aria-label="Toggle auto intervention" /></label>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2">
                <ControlButton icon={<AudioLines />} label={audioState.ducked ? "Restore audio" : "Duck caller audio"} sub={audioState.ducked ? "Caller at −12 dB" : "Attenuate −12 dB"}
                  active={audioState.ducked} disabled={phase !== "active"}
                  onClick={() => { if (audioState.ducked) { audioEngine.duck(false); log("Audio restored", "neutral", "Operator"); } else applyIntervention("duck", true); }} />
                <ControlButton icon={<Ear />} label="Security whisper" sub="Private to subscriber" active={whisperOn} disabled={phase !== "active" || whisperOn}
                  onClick={() => applyIntervention("whisper", true)} />
                <ControlButton icon={<AlertOctagon />} label="Flash alert" sub="Class 0-style overlay" active={flashOn} disabled={phase !== "active"}
                  onClick={() => applyIntervention("flash", true)} />
                <ControlButton icon={<Siren />} label="Escalate" sub="Open war-room incident" tone="critical" disabled={!script || escalating}
                  onClick={escalate} />
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card className="flex min-h-[420px] flex-col overflow-hidden">
              <CardHeader eyebrow="Transcript" title="Live call transcript" action={
                <Tabs value={view} onValueChange={(v) => setView(v as "raw" | "tokenized")}>
                  <TabsList><TabsTrigger value="tokenized">Tokenized</TabsTrigger><TabsTrigger value="raw">Raw · synthetic</TabsTrigger></TabsList>
                </Tabs>} />
              <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 pb-5 pt-4" style={{ maxHeight: 520 }}>
                {!lines.length && <EmptyTranscript phase={phase} />}
                <AnimatePresence initial={false}>
                  {lines.map((l) => (
                    <motion.div key={l.index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      className={cn("flex", l.speaker === "subscriber" && "justify-end")}>
                      <div className={cn("max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                        l.speaker === "caller" ? "rounded-tl-md bg-subtle text-ink" : "rounded-tr-md bg-accent/15 text-ink ring-1 ring-accent/25")}>
                        <div className={cn("mb-0.5 text-[11px] font-medium", l.speaker === "caller" ? "text-muted" : "text-[#86efac]/80")}>
                          {l.speaker === "caller" ? "Caller" : "Subscriber"}{l.signals.length > 0 && <span className="ml-1.5 text-critical">· {l.signals[0]}</span>}
                        </div>
                        {view === "raw" ? l.text : <TokenizedText text={l.tokenized} dark={l.speaker !== "caller"} />}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={transcriptEnd} />
              </div>
              {view === "raw" && lines.length > 0 && (
                <div className="border-t border-line bg-high-soft px-5 py-2 text-[11.5px] text-[#ffc9a3]">
                  Raw view shows synthetic data locally. Only the tokenized form is ever sent to the gateway or AI.
                </div>
              )}
            </Card>

            <Card className="flex flex-col">
              <CardHeader eyebrow="Live incident timeline" title="Carrier events" action={<SimulatedTag />} />
              <ol className="scroll-thin flex-1 space-y-0 overflow-y-auto px-5 pb-5 pt-4" style={{ maxHeight: 520 }}>
                {!timeline.length && <li className="py-10 text-center text-[13px] text-muted">Events appear as the call unfolds.</li>}
                {timeline.map((t, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative flex gap-3 pb-3.5">
                    {i < timeline.length - 1 && <span className="absolute left-[4.5px] top-4 h-full w-px bg-line" />}
                    <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-surface",
                      t.tone === "critical" ? "bg-critical" : t.tone === "warn" ? "bg-high" : t.tone === "ok" ? "bg-ok" : "bg-line-strong")} />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium leading-snug">{t.label}</div>
                      {t.detail && <div className="text-[11.5px] text-muted">{t.detail}</div>}
                    </div>
                    <span className="ml-auto shrink-0 pt-0.5 text-[11px] text-faint tnum">{mmss(t.t)}</span>
                  </motion.li>
                ))}
              </ol>
            </Card>
          </div>

          <AnimatePresence>
            {phase === "ended" && script && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card className="flex flex-col items-start justify-between gap-4 p-5 md:flex-row md:items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-critical-soft text-critical"><ShieldAlert className="size-5" /></div>
                    <div>
                      <div className="text-[15px] font-semibold">Call ended with risk {risk}. Open an incident?</div>
                      <div className="text-[13px] text-muted">The tokenized transcript ({lines.reduce((s, l) => s + Object.values(l.counts).reduce((a, b) => a + b, 0), 0)} values removed) becomes the incident record.</div>
                    </div>
                  </div>
                  <Button size="lg" onClick={escalate} loading={escalating}>Escalate to war room <ArrowRight /></Button>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Page-level flash echo */}
      <AnimatePresence>
        {flashOn && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.6, 1] }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}
            className="pointer-events-none fixed inset-0 z-20 shadow-[inset_0_0_0_3px_var(--color-critical),inset_0_0_120px_rgba(229,72,77,0.18)]" />
        )}
      </AnimatePresence>
    </>
  );
}

function ControlButton({ icon, label, sub, onClick, disabled, active, tone }: {
  icon: React.ReactNode; label: string; sub: string; onClick: () => void; disabled?: boolean; active?: boolean; tone?: "critical";
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("group flex flex-col items-start gap-2.5 rounded-xl border p-3 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        active ? "border-accent bg-accent text-on-ink" : tone === "critical" ? "border-critical/25 bg-critical-soft/50 hover:border-critical/50" : "border-line hover:border-line-strong hover:bg-subtle/50")}>
      <span className={cn("[&_svg]:size-4", active ? "text-on-ink" : tone === "critical" ? "text-critical" : "text-ink-2")}>{icon}</span>
      <span>
        <span className="block text-[12.5px] font-semibold leading-tight">{label}</span>
        <span className={cn("block text-[11px]", active ? "text-on-ink/70" : "text-muted")}>{sub}</span>
      </span>
    </button>
  );
}

function TokenizedText({ text, dark }: { text: string; dark?: boolean }) {
  const parts = text.split(/(\[[A-Z]+_[0-9A-F]{6}\])/g);
  return <>{parts.map((p, i) => /^\[[A-Z]+_[0-9A-F]{6}\]$/.test(p)
    ? <span key={i} className={cn("rounded-md px-1 py-px text-[12px] font-medium", dark ? "bg-white/15 text-white" : "token-chip")}>{p}</span>
    : <span key={i}>{p}</span>)}</>;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 220, h = 56;
  if (values.length < 2) return <div className="flex h-14 items-center text-[12px] text-faint">Risk trajectory appears here</div>;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (v / 100) * h] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full overflow-visible" preserveAspectRatio="none" aria-label="Risk trajectory">
      {[45, 65, 85].map((t) => <line key={t} x1={0} x2={w} y1={h - (t / 100) * h} y2={h - (t / 100) * h} stroke="var(--color-line)" strokeDasharray="3 4" />)}
      <motion.path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        initial={false} animate={{ d }} transition={{ duration: 0.5 }} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={2} />
    </svg>
  );
}

function EmptyTranscript({ phase }: { phase: Phase }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-subtle text-muted">{phase === "ringing" ? <Phone className="size-4 animate-pulse" /> : <Mic className="size-4" />}</div>
      <div className="text-[13px] text-muted">{phase === "ringing" ? "Answer the call on the device to begin." : "Simulate a call to start the live transcript."}</div>
    </div>
  );
}

/* ─────────────────────────────── Phone device ─────────────────────────────── */

function PhoneDevice(props: {
  phase: Phase; script: CallScript | null; elapsed: number; ducked: boolean; speaking: boolean; whisperOn: boolean; flashOn: boolean;
  lastLine?: ShownLine; onAnswer: () => void; onDecline: () => void; onHangup: () => void; onDismissFlash: () => void;
}) {
  const { phase, script, elapsed, ducked, speaking, whisperOn, flashOn, onAnswer, onDecline, onHangup, onDismissFlash, lastLine } = props;
  const now = new Date();
  return (
    <div className="relative mx-auto aspect-[9/18.5] w-full max-w-[340px] rounded-[48px] bg-[#151a16] p-[10px] ring-1 ring-white/10 shadow-[var(--shadow-phone)]">
      <div className="relative h-full overflow-hidden rounded-[40px] bg-night text-white">
        <div className="absolute left-1/2 top-2.5 z-30 h-[26px] w-[96px] -translate-x-1/2 rounded-full bg-black" />
        <div className="flex items-center justify-between px-7 pt-3.5 text-[12px] font-semibold">
          <span className="tnum">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="flex items-center gap-1 text-white/80">5G <span className="inline-block h-2.5 w-5 rounded-[3px] border border-white/60 p-px"><span className="block h-full w-3/4 rounded-[1px] bg-white" /></span></span>
        </div>

        <AnimatePresence mode="wait">
          {phase === "idle" && (
            <motion.div key="idle" className="flex h-[88%] flex-col items-center justify-center px-8 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="text-[64px] font-light leading-none tracking-[-0.04em] tnum">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/, "")}</div>
              <div className="mt-2 text-[14px] text-white/55">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
              <div className="mt-16 flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[11.5px] text-white/60"><ShieldAlert className="size-3.5" />Carrier defense active</div>
            </motion.div>
          )}

          {phase === "ringing" && script && (
            <motion.div key="ringing" className="flex h-[92%] flex-col items-center justify-between px-6 pb-8 pt-12 text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex flex-col items-center">
                <div className="text-[12.5px] text-white/50">Incoming call</div>
                <div className="mt-2 text-[28px] font-semibold tracking-[-0.02em]">{script.caller.display_name}</div>
                <div className="mt-1 text-[14px] text-white/60 tnum">{script.caller.number}</div>
                <div className="mt-4 flex items-center gap-1.5 rounded-full bg-critical/15 px-3 py-1 text-[11.5px] font-medium text-[#ff8a8e]">
                  <ShieldAlert className="size-3.5" />Unverified · attestation {script.caller.attestation}
                </div>
                <div className="mt-2 text-[11px] text-white/40">{script.caller.carrier_route}</div>
              </div>
              <div className="relative flex size-24 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-white/10 animate-pulse-ring" />
                <span className="flex size-20 items-center justify-center rounded-full bg-white/[0.08] text-[28px] font-medium">{script.caller.display_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
              </div>
              <div className="flex w-full justify-between px-4">
                <PhoneRound label="Decline" color="bg-critical" onClick={onDecline}><PhoneOff /></PhoneRound>
                <PhoneRound label="Accept" color="bg-ok" onClick={onAnswer} pulse><Phone /></PhoneRound>
              </div>
            </motion.div>
          )}

          {(phase === "active" || phase === "ended") && script && (
            <motion.div key="active" className="flex h-[92%] flex-col items-center px-6 pb-8 pt-10 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="text-[22px] font-semibold tracking-[-0.02em]">{script.caller.display_name}</div>
              <div className="mt-1 text-[13px] text-white/55 tnum">{phase === "ended" ? `Call ended · ${mmss(elapsed)}` : mmss(elapsed)}</div>
              <div className="mt-8 h-20 w-full"><Waveform active={phase === "active"} ducked={ducked} speaking={speaking} /></div>
              <AnimatePresence>
                {ducked && phase === "active" && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-3 flex items-center gap-1.5 rounded-full bg-high/15 px-3 py-1 text-[11px] font-medium text-[#ffb37a]">
                    <MicOff className="size-3" />Caller audio ducked −12 dB
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-auto w-full">
                {lastLine && phase === "active" && (
                  <motion.p key={lastLine.index} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 line-clamp-3 text-[12.5px] leading-relaxed text-white/60">
                    “{lastLine.text}”
                  </motion.p>
                )}
                {phase === "active" && <div className="flex justify-center"><PhoneRound label="End" color="bg-critical" onClick={onHangup}><PhoneOff /></PhoneRound></div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Security whisper banner */}
        <AnimatePresence>
          {whisperOn && (
            <motion.div initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="absolute inset-x-3 top-11 z-20 rounded-2xl border border-white/10 bg-[#0f1a13]/95 p-3.5 text-left shadow-2xl backdrop-blur-xl">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#86efac]"><Ear className="size-3.5" />Carrier security whisper <LiveDot color="#86efac" className="ml-auto" /></div>
              <p className="text-[12px] leading-relaxed text-white/80">This caller could not be verified. Don't share codes or your SSN. Hang up and call back on a trusted number.</p>
              <div className="mt-1.5 text-[10.5px] text-white/40">Private — the caller cannot hear this</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Flash alert overlay */}
        <AnimatePresence>
          {flashOn && (
            <motion.div initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#2a0a0c]/95 px-6 text-center backdrop-blur-md">
              <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}
                className="flex size-16 items-center justify-center rounded-full bg-critical text-white"><Zap className="size-7" /></motion.div>
              <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ff8a8e]">Security alert</div>
              <div className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em]">Likely scam call in progress</div>
              <p className="mt-3 text-[13px] leading-relaxed text-white/70">Your carrier detected requests for one-time codes and personal identifiers. Legitimate staff will never ask for these.</p>
              <button onClick={() => { onDismissFlash(); onHangup(); }} className="mt-7 w-full rounded-2xl bg-critical py-3 text-[14px] font-semibold">Hang up now</button>
              <button onClick={onDismissFlash} className="mt-2 w-full rounded-2xl py-2.5 text-[13px] text-white/60">Dismiss</button>
              <div className="mt-4 text-[10px] text-white/35">Simulated flash (Class 0-style) alert</div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/40" />
      </div>
    </div>
  );
}

function PhoneRound({ children, label, color, onClick, pulse }: { children: React.ReactNode; label: string; color: string; onClick: () => void; pulse?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.button whileTap={{ scale: 0.92 }} onClick={onClick} aria-label={label}
        className={cn("relative flex size-[62px] items-center justify-center rounded-full text-white [&_svg]:size-6", color)}>
        {pulse && <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", color)} />}
        <span className="relative">{children}</span>
      </motion.button>
      <span className="text-[11.5px] text-white/70">{label}</span>
    </div>
  );
}

function Waveform({ active, ducked, speaking }: { active: boolean; ducked: boolean; speaking: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ ducked, speaking, active });
  state.current = { ducked, speaking, active };
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const bars = 36;
    const smooth = new Array(bars).fill(0);
    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { ducked: d, speaking: s, active: a } = state.current;
      const level = Math.max(audioEngine.level() * 2.2, s ? 0.55 : 0.08);
      const gain = !a ? 0.04 : d ? 0.3 : 1;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const n = (Math.sin(t / 140 + i * 0.7) + Math.sin(t / 90 + i * 1.9) + 2) / 4;
        const target = Math.min(1, level * gain * (0.35 + n * 0.9) * (1 - Math.abs(i - bars / 2) / (bars * 0.75)));
        smooth[i] += (target - smooth[i]) * 0.25;
        const bh = Math.max(3, smooth[i] * h);
        ctx.fillStyle = d && a ? "rgba(255,179,122,0.75)" : "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.roundRect(i * bw + bw * 0.25, (h - bh) / 2, bw * 0.5, bh, 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="h-full w-full" aria-hidden />;
}
