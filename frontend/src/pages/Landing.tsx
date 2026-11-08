import Lenis from "lenis";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import {
  ArrowRight, ArrowUpRight, BrainCircuit, ChevronDown, Eye, FileText, Lock, PhoneCall, Radar, ShieldCheck, Siren,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ConvergeText, Reveal, Scramble, ScrollWords, TrackIn, useSectionProgress } from "@/components/motion";
import { AnimatedNumber } from "@/components/domain";
import { TypedTitle } from "@/components/TypedTitle";
import { BrandMark, Wordmark } from "@/components/layout/Brand";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { AgentStep, Dashboard, EvalResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ───────────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [evals, setEvals] = useState<EvalResult[]>([]);

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    window.scrollTo(0, 0);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
  }, []);

  useEffect(() => {
    api.dashboard().then(setDash).catch(() => undefined);
    api.evalRuns().then(setEvals).catch(() => undefined);
  }, []);

  return (
    <div className="relative overflow-x-clip bg-canvas text-ink">
      <LandingNav />
      <Hero dash={dash} />
      <Statement />
      <Lifecycle />
      <AgentLoop evals={evals} />
      <PrivacyMorph />
      <Proof dash={dash} evals={evals} />
      <FinalCTA />
      <footer className="border-t border-line px-6 py-10 text-center text-[12px] text-faint">
        Carrier operations are simulated. The NVIDIA Nemotron agent and the risk engine run live. Only tokenized data is processed. Built at HackUTD.
      </footer>
    </div>
  );
}

/* ── Nav ────────────────────────────────────────────────────────────────── */

function LandingNav() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setSolid(v > 40));
  return (
    <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }}
      className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav className={cn("flex w-full max-w-[1080px] items-center justify-between rounded-2xl border px-3 py-2 transition-all duration-500",
        solid ? "border-white/10 bg-black/55 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl" : "border-transparent bg-transparent")}>
        <Link to="/" className="flex items-center gap-2.5 pl-1">
          <BrandMark size={34} />
          <Wordmark className="hidden text-[16px] sm:inline-flex" />
        </Link>
        <div className="hidden items-center gap-1 text-[13px] text-ink-2 md:flex">
          {[["Proactive", "/proactive"], ["Live call", "/live-call"], ["War room", "/war-room"], ["Evaluation", "/evaluation"]].map(([l, to]) => (
            <Link key={to} to={to} className="rounded-lg px-3 py-1.5 transition hover:bg-white/[0.06] hover:text-ink">{l}</Link>
          ))}
        </div>
        <Button size="sm" asChild><Link to="/command">Open console <ArrowRight /></Link></Button>
      </nav>
    </motion.header>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────────── */

function Hero({ dash }: { dash: Dashboard | null }) {
  const ref = useRef<HTMLElement>(null);
  // The hero pins for ~1.6 screens while scrolling types the title, then reveals the copy.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const typing = useTransform(scrollYProgress, [0.03, 0.62], [0, 1], { clamp: true });
  const reveal = useTransform(scrollYProgress, [0.6, 0.78], [0, 1], { clamp: true });
  const revealY = useTransform(reveal, [0, 1], [24, 0]);
  const hint = useTransform(scrollYProgress, [0, 0.08], [1, 0]);
  const [breach, setBreach] = useState(false);

  return (
    <>
      <section ref={ref} className="relative h-[260vh]">
        <div className="noise sticky top-0 flex h-[100svh] flex-col items-center justify-center overflow-hidden px-5 text-center">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-[-18%] h-[70vh] w-[90vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(74,222,128,0.16),transparent_65%)] blur-2xl animate-drift" />
            <div className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_40%,black,transparent_70%)]" />
          </div>
          <div className="relative flex w-full max-w-[1180px] flex-col items-center">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }}
              className="mb-7 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.07] px-3.5 py-1.5 text-[12px] font-medium text-[#86efac]">
              <BrainCircuit className="size-3.5" /> Incident response agent built on NVIDIA Nemotron
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.8 }}
              className="type-prompt mb-5 self-center whitespace-nowrap text-[11px] sm:text-[12.5px] md:text-[15px]">
              <span className="text-accent">carrier-gw</span><span className="text-faint">:</span><span className="text-[#60a5fa]">~</span><span className="text-faint">$</span> ./block_around_the_clock --protect
            </motion.div>
            <TypedTitle progress={typing} className="w-full" />
            <motion.p style={{ opacity: reveal, y: revealY }}
              className="mt-8 max-w-[620px] text-[17px] leading-relaxed text-ink-2 md:text-[19px]">
              A carrier-level security gateway for phone and text scams. It flags risky network activity, warns the subscriber during a suspicious call, and runs the account lockdown steps after an attack.
            </motion.p>
            <motion.div style={{ opacity: reveal, y: revealY }} className="mt-9 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild><Link to="/command">Open the console <ArrowRight /></Link></Button>
              <Button size="lg" variant="secondary" asChild><Link to="/live-call"><PhoneCall />Run a call simulation</Link></Button>
            </motion.div>
          </div>
          <motion.div style={{ opacity: hint }} className="type-prompt absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-[15px] text-faint">
            scroll to run <ChevronDown className="size-4 animate-bounce" />
          </motion.div>
        </div>
      </section>
      <section className="relative mx-auto -mt-[10vh] w-full max-w-[560px] px-5 pb-10">
        <Reveal><NetworkConsole breach={breach} setBreach={setBreach} dash={dash} /></Reveal>
      </section>
    </>
  );
}

function NetworkConsole({ breach, setBreach, dash }: { breach: boolean; setBreach: (b: boolean) => void; dash: Dashboard | null }) {
  const color = breach ? "#f2555a" : "#4ade80";
  const threat = dash ? (dash.metrics.threats_detected_24h / Math.max(1, dash.metrics.events_analyzed_24h)) * (breach ? 100 : 1.2) : 0.01;
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#0a0d0b]/90 text-left shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur">
      <div className="relative h-[200px] bg-[radial-gradient(ellipse_at_50%_40%,rgba(74,222,128,0.12),transparent_70%)]"
        style={breach ? { background: "radial-gradient(ellipse at 50% 40%, rgba(242,85,90,0.16), transparent 70%)" } : undefined}>
        <svg viewBox="0 0 520 200" className="absolute inset-0 h-full w-full">
          <path id="wire" d="M 60 92 C 150 92, 170 70, 260 82 S 380 100, 460 92" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
          {/* benign packets travel the full path */}
          {[0, 1.3, 2.6].map((d) => (
            <circle key={d} r="3" fill="#ffffff">
              <animateMotion dur="3.9s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#wire" /></animateMotion>
            </circle>
          ))}
          {/* hostile packets stop at the gateway */}
          {[0.6, 2.2].map((d) => (
            <circle key={d} r="3.5" fill="#f2555a">
              <animateMotion dur="2.4s" begin={`${d}s`} repeatCount="indefinite" keyPoints="0;0.48;0.48" keyTimes="0;0.6;1" calcMode="linear"><mpath href="#wire" /></animateMotion>
              <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.6;0.7;1" dur="2.4s" begin={`${d}s`} repeatCount="indefinite" />
            </circle>
          ))}
          {[[60, 92, "Carrier network"], [460, 92, "Subscriber"]].map(([x, yy, label]) => (
            <g key={label as string}>
              <circle cx={x as number} cy={yy as number} r="9" fill="#0a0d0b" stroke={color} strokeWidth="1.5" />
              <circle cx={x as number} cy={yy as number} r="3" fill={color} />
              <text x={x as number} y={(yy as number) + 30} textAnchor="middle" fontSize="11" fill="#7d8880">{label as string}</text>
            </g>
          ))}
          <g transform="translate(260 80)">
            <circle r="44" fill="none" stroke={color} strokeOpacity="0.18">
              <animate attributeName="r" values="34;54;34" dur="3s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.35;0;0.35" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle r="32" fill="#0a0d0b" stroke={color} strokeOpacity="0.6" strokeWidth="1.5" />
            <path d="M0 -15 L12 -10 L12 1 C12 9 6 14 0 17 C-6 14 -12 9 -12 1 L-12 -10 Z" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.6" />
            {breach ? <path d="M-5 -4 L5 6 M5 -4 L-5 6" stroke={color} strokeWidth="2" strokeLinecap="round" />
              : <path d="M-5 1 L-1 5 L6 -3" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
            <text y="52" textAnchor="middle" fontSize="11" fill="#b8c2bb">Defense gateway</text>
          </g>
        </svg>
        <div className="absolute inset-x-0 bottom-3 text-center">
          <div className="text-[12px] font-semibold uppercase tracking-[0.24em]" style={{ color: breach ? "#ff8a8e" : "#eef3ef" }}>{breach ? "Suspicious traffic detected" : "No active threats"}</div>
          <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.18em]" style={{ color }}>{breach ? "Calls held for review" : "Monitoring carrier traffic"}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 border-y border-white/[0.06] text-center">
        {[["Threat level", `${threat.toFixed(2)}%`, breach], ["Events · 24h", dash ? dash.metrics.events_analyzed_24h.toString() : "—", false],
          ["Audit chain", dash ? (dash.audit_chain.valid ? "Intact" : "Broken") : "—", false]].map(([k, v, red]) => (
          <div key={k as string} className="px-3 py-3.5">
            <div className="text-[11px] text-muted">{k as string}</div>
            <div className={cn("mt-0.5 text-[15px] font-semibold tnum", red ? "text-[#ff8a8e]" : k === "Threat level" ? "text-[#86efac]" : "text-ink")}>{v as string}</div>
          </div>
        ))}
      </div>
      <div className="p-3.5">
        <div className="mb-2 text-[11.5px] text-muted">System mode</div>
        <div className="relative grid grid-cols-2 rounded-xl bg-white/[0.04] p-1 text-[12.5px] font-medium">
          <motion.div layout className="absolute inset-y-1 w-[calc(50%-4px)] rounded-lg" style={{ left: breach ? "calc(50% + 0px)" : 4, background: breach ? "#f2555a" : "#4ade80" }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }} />
          <button onClick={() => setBreach(false)} className={cn("relative z-10 rounded-lg py-1.5 transition", !breach ? "text-on-ink" : "text-ink-2")}>Secure mode</button>
          <button onClick={() => setBreach(true)} className={cn("relative z-10 rounded-lg py-1.5 transition", breach ? "text-white" : "text-ink-2")}>Simulate attack</button>
        </div>
      </div>
    </div>
  );
}

/* ── Statement: words light up with scroll ─────────────────────────────── */

function Statement() {
  const { ref, progress } = useSectionProgress();
  const p = useTransform(progress, [0.05, 0.85], [0, 1]);
  return (
    <section ref={ref} className="relative h-[240vh]">
      <div className="sticky top-0 flex h-[100svh] items-center">
        <div className="mx-auto max-w-[1100px] px-6">
          <div className="eyebrow mb-8"><TrackIn>The problem</TrackIn></div>
          <ScrollWords progress={p} accent={["conversation,"]}
            className="text-[clamp(30px,4.6vw,64px)] font-semibold leading-[1.12] tracking-[-0.03em]"
            text="Most account takeovers start with a conversation, not a software exploit. An attacker poses as a bank or IT support, asks for a one-time code or Social Security number, then moves the victim's number to a new SIM and resets the linked accounts." />
        </div>
      </div>
    </section>
  );
}

/* ── Before / During / After: words brighten one by one ────────────────── */

const PHASES = [
  { word: "Before.", title: "Detect risk before the call connects.", copy: "The gateway scores carrier signals in real time, including SIM swap and port-out requests, spoofed caller IDs and forced downgrades to unencrypted 2G. High-risk events are flagged before the subscriber answers.", to: "/proactive", icon: Radar },
  { word: "During.", title: "Warn the subscriber during the call.", copy: "When the call's risk score crosses set thresholds, the network lowers the caller's volume, plays a private warning that only the subscriber hears, and shows a full-screen alert.", to: "/live-call", icon: PhoneCall },
  { word: "After.", title: "Lock down accounts after an attack.", copy: "An agent built on NVIDIA Nemotron locks the SIM, places credit freezes and revokes active sessions. If a step fails, it reads the error and chooses the next step.", to: "/war-room", icon: Siren },
];

function Lifecycle() {
  const { ref, progress } = useSectionProgress();
  const [active, setActive] = useState(0);
  useMotionValueEvent(progress, "change", (v) => setActive(Math.min(2, Math.max(0, Math.floor(v * 3.2 - 0.1)))));
  const bar = useTransform(progress, [0, 1], ["0%", "100%"]);
  return (
    <section ref={ref} className="relative h-[340vh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1180px] items-center gap-6 px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
          <div>
            <div className="eyebrow mb-6"><TrackIn>How it works</TrackIn></div>
            <div className="flex flex-wrap gap-x-3 lg:block lg:space-y-1">
              {PHASES.map((ph, i) => (
                <motion.div key={ph.word} animate={{ opacity: i === active ? 1 : i < active ? 0.28 : 0.12, x: i === active ? 0 : -6 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className={cn("-mb-[0.12em] pb-[0.12em] text-[clamp(36px,9vw,128px)] font-semibold leading-[0.95] tracking-[-0.05em]", i === active && "text-signal")}>
                  {ph.word}
                </motion.div>
              ))}
            </div>
            <div className="mt-8 h-[2px] w-56 overflow-hidden rounded-full bg-white/[0.07]"><motion.div style={{ width: bar }} className="h-full bg-accent" /></div>
          </div>
          <div className="relative lg:min-h-[420px]">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 30, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -20, filter: "blur(6px)" }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
                <PhasePanel i={active} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhasePanel({ i }: { i: number }) {
  const ph = PHASES[i];
  return (
    <div className="card overflow-hidden p-6 md:p-8">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/25"><ph.icon className="size-5" /></span>
        <span className="eyebrow">{["Proactive defense", "Live call defense", "Incident war room"][i]}</span>
      </div>
      <h3 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] md:text-[34px]">{ph.title}</h3>
      <p className="mt-3 max-w-[460px] text-[15px] leading-relaxed text-muted">{ph.copy}</p>
      <div className="mt-6 hidden sm:block">
        {i === 0 && <MiniTelemetry />}
        {i === 1 && <MiniCall />}
        {i === 2 && <MiniTrace />}
      </div>
      <Link to={ph.to} className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">Open this module <ArrowUpRight className="size-4" /></Link>
    </div>
  );
}

function MiniTelemetry() {
  const rows = [["Unauthenticated 2G downgrade", 92, "#f2555a"], ["SIM swap request", 88, "#f2555a"], ["Spoofed VoIP call", 71, "#f5843a"], ["Routine network attach", 9, "#4ade80"]] as const;
  return (
    <div className="space-y-2.5">
      {rows.map(([l, v, c], idx) => (
        <motion.div key={l} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + idx * 0.08 }}
          className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
          <span className="flex-1 text-[13px] text-ink-2">{l}</span>
          <div className="h-1 w-24 rounded-full bg-white/[0.06]"><motion.div className="h-full rounded-full" style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ delay: 0.3 + idx * 0.08, duration: 0.8 }} /></div>
          <span className="w-7 text-right text-[13px] font-semibold tnum">{v}</span>
        </motion.div>
      ))}
    </div>
  );
}

function MiniCall() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-black/40 p-4">
      <div className="flex items-center justify-between text-[13px]"><span className="font-semibold">IT Service Desk</span><span className="rounded-full bg-critical/15 px-2 py-0.5 text-[11px] text-[#ff8a8e]">Unverified · attestation C</span></div>
      <div className="flex h-12 items-center justify-center gap-[3px]">
        {Array.from({ length: 40 }).map((_, k) => (
          <motion.span key={k} className="w-[3px] rounded-full bg-[#ffb37a]/70" animate={{ height: [6, 8 + ((k * 37) % 30), 6] }}
            transition={{ repeat: Infinity, duration: 0.9 + (k % 5) * 0.12, delay: k * 0.02 }} />
        ))}
      </div>
      <div className="text-center text-[11px] font-medium text-[#ffb37a]">Caller audio ducked −12 dB</div>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        className="rounded-xl border border-accent/25 bg-accent/[0.08] p-3 text-[12.5px] leading-relaxed text-ink-2">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-accent">Private warning to subscriber</span>
        This caller could not be verified. Do not share codes or your SSN.
      </motion.div>
    </div>
  );
}

function MiniTrace() {
  const lines = [["tool", "lock_sim()"], ["fail", "PORT_OUT_IN_PROGRESS"], ["replan", "block_port_out()"], ["ok", "PORT_FROZEN"], ["tool", "lock_sim()"], ["ok", "LOCKED"]] as const;
  return (
    <div className="space-y-1.5 font-mono text-[12.5px]">
      {lines.map(([k, t], idx) => (
        <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + idx * 0.1 }}
          className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5",
            k === "fail" ? "bg-critical/10 text-[#ff8a8e]" : k === "replan" ? "bg-high/10 text-[#ffb37a]" : k === "ok" ? "ml-5 text-[#86efac]" : "bg-white/[0.04] text-ink")}>
          <span className="w-14 text-[10.5px] uppercase tracking-wide opacity-60">{k === "tool" ? "call" : k === "fail" ? "result" : k === "replan" ? "replan" : "result"}</span>{t}
        </motion.div>
      ))}
    </div>
  );
}

/* ── Agent loop ─────────────────────────────────────────────────────────── */

const LOOP = ["Assess", "Act", "Observe", "Replan"];

/** Recorded from a live Nemotron 3.5 Lightning evaluation run (port-out dependency), used only when no run is stored yet. */
const RECORDED: { kind: string; text: string }[] = [
  { kind: "assess", text: "record_assessment(severity: critical) — social-engineered eSIM swap" },
  { kind: "call", text: "lock_sim()" },
  { kind: "fail", text: "PORT_OUT_IN_PROGRESS · port-out request in flight" },
  { kind: "replan", text: "block_port_out() — port-out is in flight, freeze it first" },
  { kind: "ok", text: "PORT_FROZEN · pending port-out cancelled" },
  { kind: "call", text: "lock_sim() — retry after the fix" },
  { kind: "ok", text: "LOCKED" },
  { kind: "final", text: "complete_containment()" },
];

function traceFrom(evals: EvalResult[]) {
  const withReplan = evals.find((e) => e.run && e.run.steps.some((s) => s.kind === "tool_call" && s.replan));
  if (!withReplan?.run) return { lines: RECORDED, source: "Recorded live run · Nemotron 3.5 Lightning" };
  const lines: { kind: string; text: string }[] = [];
  for (const s of withReplan.run.steps as AgentStep[]) {
    if (s.kind === "assessment") lines.push({ kind: "assess", text: `record_assessment(severity: ${s.args.severity})` });
    if (s.kind === "tool_call") lines.push({ kind: s.replan ? "replan" : "call", text: `${s.tool}(${Object.entries(s.args).filter(([k]) => k !== "rationale").map(([k, v]) => `${k}: ${v}`).join(", ")})` });
    if (s.kind === "observation") lines.push({ kind: s.result.ok ? "ok" : "fail", text: `${s.result.code}` });
    if (s.kind === "final" || s.kind === "escalation") lines.push({ kind: "final", text: `${s.tool}()` });
  }
  return { lines: lines.slice(0, 10), source: `Live run ${withReplan.run.id} · ${withReplan.run.model.replace("nvidia/", "")}` };
}

function AgentLoop({ evals }: { evals: EvalResult[] }) {
  const { ref, progress } = useSectionProgress();
  const head = useTransform(progress, [0, 0.22], [0, 1]);
  const ring = useTransform(progress, [0.15, 0.95], [0, 1]);
  const { lines, source } = useMemo(() => traceFrom(evals), [evals]);
  const [shown, setShown] = useState(0);
  const [node, setNode] = useState(0);
  useMotionValueEvent(progress, "change", (v) => {
    const t = Math.max(0, Math.min(1, (v - 0.18) / 0.75));
    const n = Math.round(t * lines.length);
    setShown(n);
    const k = lines[Math.max(0, n - 1)]?.kind ?? "assess";
    setNode({ assess: 0, call: 1, fail: 2, ok: 2, replan: 3, final: 0 }[k] ?? 0);
  });
  return (
    <section ref={ref} className="relative h-[380vh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(118,185,0,0.1),transparent_60%)]" />
        <div className="relative mx-auto grid w-full max-w-[1180px] items-center gap-6 px-6 md:gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="eyebrow mb-5"><TrackIn>Automated incident response</TrackIn></div>
            <h2 className="text-[clamp(40px,6vw,84px)] font-semibold leading-[0.98] tracking-[-0.045em]">
              <ConvergeText text="Act. Observe." progress={head} spread={0.7} />
              <br />
              <ConvergeText text="Replan." progress={head} spread={1} className="text-signal" letterClassName="text-signal" />
            </h2>
            <p className="mt-6 max-w-[460px] text-[15px] leading-relaxed text-muted">
              The agent receives a sanitized incident and calls one approved tool at a time. It reads each result before choosing the next step.
              If a tool fails, for example because a port-out request is already in progress, it fixes the cause or uses an alternative instead of retrying the same call.
            </p>
            <div className="mt-10 hidden items-center gap-8 md:flex">
              <LoopRing progress={ring} node={node} />
              <ul className="space-y-2 text-[14px]">
                {LOOP.map((l, i) => (
                  <li key={l} className={cn("flex items-center gap-2.5 transition-colors duration-300", i === node ? "text-ink" : "text-faint")}>
                    <span className={cn("size-1.5 rounded-full transition", i === node ? "bg-accent shadow-[0_0_10px_#4ade80]" : "bg-white/20")} />{l}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between text-[11.5px] text-muted">
              <span className="flex items-center gap-2"><BrainCircuit className="size-3.5 text-accent" />Agent trace</span><span>{source}</span>
            </div>
            <div className="max-h-[46vh] space-y-1.5 overflow-hidden font-mono text-[12.5px] md:max-h-none">
              {lines.map((l, idx) => (
                <motion.div key={idx} animate={{ opacity: idx < shown ? 1 : 0.06, x: idx < shown ? 0 : 10 }} transition={{ duration: 0.4 }}
                  className={cn("flex items-start gap-2 rounded-lg px-3 py-2",
                    l.kind === "fail" ? "bg-critical/10 text-[#ff8a8e]" : l.kind === "replan" ? "bg-high/10 text-[#ffb37a]" :
                      l.kind === "ok" ? "ml-6 text-[#86efac]" : l.kind === "assess" ? "bg-accent/[0.07] text-[#c7f9d6]" : l.kind === "final" ? "bg-accent/15 text-accent" : "bg-white/[0.04] text-ink")}>
                  <span className="w-[52px] shrink-0 pt-px text-[10px] uppercase tracking-wide opacity-60">
                    {{ assess: "assess", call: "act", fail: "observe", ok: "observe", replan: "replan", final: "done" }[l.kind]}
                  </span>
                  <span className="break-all">{l.text}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LoopRing({ progress, node }: { progress: MotionValue<number>; node: number }) {
  const pts = [[60, 8], [112, 60], [60, 112], [8, 60]];
  return (
    <svg viewBox="0 0 120 120" className="size-36 shrink-0">
      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
      <motion.circle cx="60" cy="60" r="52" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round"
        style={{ pathLength: progress, rotate: -90, transformOrigin: "60px 60px" }} />
      {pts.map(([x, y], i) => (
        <g key={i}>
          {i === node && <circle cx={x} cy={y} r="10" fill="#4ade80" opacity="0.18"><animate attributeName="r" values="7;12;7" dur="1.4s" repeatCount="indefinite" /></circle>}
          <circle cx={x} cy={y} r="5" fill={i === node ? "#4ade80" : "#1b211d"} stroke="#4ade80" strokeOpacity={i === node ? 1 : 0.4} strokeWidth="1.5" />
        </g>
      ))}
      <text x="60" y="64" textAnchor="middle" fontSize="10" fill="#b8c2bb" fontWeight="600">Nemotron</text>
    </svg>
  );
}

/* ── Privacy: raw values scramble into tokens ──────────────────────────── */

function PrivacyMorph() {
  const { ref, progress } = useSectionProgress();
  const title = useTransform(progress, [0, 0.35], [0, 1]);
  const rows = [
    ["Name", "Maya Chen", "[PERSON_F87670]"],
    ["Phone", "415-555-0198", "[PHONE_D9D38B]"],
    ["SSN", "512-44-8890", "[SSN_1918B2]"],
    ["One-time code", "482913", "[OTP_CC5820]"],
  ];
  return (
    <section ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto w-full max-w-[1000px] px-6">
          <div className="eyebrow mb-6"><TrackIn><Lock className="size-3" />Data privacy</TrackIn></div>
          <ScrollWords progress={title} accent={["removed"]} className="text-[clamp(36px,5.4vw,76px)] font-semibold leading-[1.02] tracking-[-0.04em]"
            text="Personal data is removed before analysis." />
          <div className="mt-12 grid gap-3">
            {rows.map(([label, from, to], i) => (
              <ScrambleRow key={label} label={label} from={from} to={to} progress={progress} start={0.35 + i * 0.1} />
            ))}
          </div>
          <p className="mt-8 flex items-center gap-2 text-[14px] text-muted"><Eye className="size-4" />Values are replaced with tokens in the browser and checked again on the server. Tokens cannot be converted back.</p>
        </div>
      </div>
    </section>
  );
}

function ScrambleRow({ label, from, to, progress, start }: { label: string; from: string; to: string; progress: MotionValue<number>; start: number }) {
  const p = useTransform(progress, [start, start + 0.18], [0, 1]);
  const bg = useTransform(p, [0, 1], ["rgba(242,85,90,0.08)", "rgba(74,222,128,0.08)"]);
  const border = useTransform(p, [0, 1], ["rgba(242,85,90,0.25)", "rgba(74,222,128,0.3)"]);
  return (
    <motion.div style={{ backgroundColor: bg, borderColor: border }} className="flex items-center justify-between rounded-2xl border px-5 py-4">
      <span className="text-[13px] text-muted">{label}</span>
      <Scramble from={from} to={to} progress={p} className="text-[clamp(16px,2.2vw,24px)] font-semibold" fromClass="text-[#ff9a9e]" toClass="text-[#86efac]" />
    </motion.div>
  );
}

/* ── Proof: numbers count up ───────────────────────────────────────────── */

function Proof({ dash, evals }: { dash: Dashboard | null; evals: EvalResult[] }) {
  const latest = useMemo(() => {
    const m = new Map<string, EvalResult>();
    for (const e of evals) if (e.grade && !m.has(e.scenario_id)) m.set(e.scenario_id, e);
    return [...m.values()];
  }, [evals]);
  const checks = latest.reduce((s, e) => s + (e.grade?.passed ?? 0), 0);
  const total = latest.reduce((s, e) => s + (e.grade?.total ?? 0), 0);
  const replans = latest.reduce((s, e) => s + (e.run?.steps.filter((x) => x.kind === "tool_call" && x.replan).length ?? 0), 0);
  const stats = [
    total ? { v: checks, suffix: `/${total}`, label: "Evaluation checks passed", sub: "Graded on live Nemotron runs", icon: ShieldCheck }
      : { v: 4, suffix: "", label: "Graded agent scenarios", sub: "Run them on the evaluation page", icon: ShieldCheck },
    { v: replans || 8, suffix: "", label: replans ? "Replans after real tool failures" : "Allowlisted containment tools", sub: replans ? "Observed in the latest evaluation" : "Validated before every call", icon: BrainCircuit },
    { v: 0, suffix: "", label: "Raw personal values sent to the model", sub: "Only tokenized values are sent", icon: Lock },
    { v: dash?.metrics.events_analyzed_24h ?? 0, suffix: "", label: "Carrier events scored today", sub: "Simulated carrier data, scored by the risk engine", icon: Radar },
  ];
  return (
    <section className="relative mx-auto max-w-[1180px] px-6 py-32">
      <div className="mb-14 max-w-[720px]">
        <div className="eyebrow mb-5"><TrackIn>Results</TrackIn></div>
        <h2 className="text-[clamp(36px,5vw,64px)] font-semibold leading-[1.02] tracking-[-0.04em]">
          <ConvergeText text="Evaluation" spread={0.6} /> <ConvergeText text="results" spread={0.8} delay={0.15} className="text-signal" letterClassName="text-signal" />
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08}>
            <div className="card h-full p-6">
              <s.icon className="size-5 text-accent" />
              <div className="mt-8 text-[48px] font-semibold leading-none tracking-[-0.05em]"><InViewNumber value={s.v} />{s.suffix && <span className="text-faint">{s.suffix}</span>}</div>
              <div className="mt-3 text-[14px] font-medium">{s.label}</div>
              <div className="mt-1 text-[12.5px] text-muted">{s.sub}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function InViewNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setGo(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <span ref={ref}><AnimatedNumber value={go ? value : 0} /></span>;
}

/* ── Final CTA ─────────────────────────────────────────────────────────── */

function FinalCTA() {
  const { ref, progress } = useSectionProgress(["start end", "end end"]);
  return (
    <section ref={ref} className="noise relative overflow-hidden px-6 pb-40 pt-24 text-center">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-[radial-gradient(ellipse_at_50%_100%,rgba(74,222,128,0.2),transparent_65%)]" />
      <h2 className="relative text-[clamp(56px,11vw,168px)] font-semibold leading-[0.9] tracking-[-0.05em]">
        <ConvergeText text="Run the" progress={progress} spread={1.2} />
        <br />
        <ConvergeText text="demo." progress={progress} spread={1.8} className="text-signal" letterClassName="text-signal" />
      </h2>
      <p className="relative mx-auto mt-8 max-w-[560px] text-[16px] leading-relaxed text-muted">
        The demo plays a scam call, removes personal data from the transcript, has the agent contain the incident, and produces a draft incident report.
      </p>
      <Reveal delay={0.1} className="relative mt-12 flex flex-wrap justify-center gap-3">
        <Button size="lg" asChild><Link to="/command">Open the console <ArrowRight /></Link></Button>
        <Button size="lg" variant="secondary" asChild><Link to="/evaluation"><BrainCircuit />Run an agent evaluation</Link></Button>
        <Button size="lg" variant="ghost" asChild><Link to="/reports"><FileText />View a sample report</Link></Button>
      </Reveal>
    </section>
  );
}
