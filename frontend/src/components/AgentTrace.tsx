import { AnimatePresence, motion } from "motion/react";
import {
  BrainCircuit, CheckCircle2, ChevronRight, Flag, GitBranch, Hand, ShieldBan, Target, Wrench, XCircle,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, AgentStep } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Renders the Nemotron agent's decision → tool call → observation → replan loop. Dark surface. */
export function AgentTrace({ run, maxHeight = 720, autoScroll = true }: { run: AgentRun; maxHeight?: number; autoScroll?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => groupTurns(run.steps), [run.steps]);
  useEffect(() => {
    if (autoScroll && run.status === "RUNNING") end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [run.steps.length, run.status, autoScroll]);
  const context = run.steps.find((s) => s.kind === "context");

  return (
    <div className="scroll-night overflow-y-auto pr-1" style={{ maxHeight }}>
      {context && context.kind === "context" && (
        <Disclosure title="Sanitized incident sent to Nemotron" icon={<ShieldBan className="size-3.5" />}>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/55">{JSON.stringify(context.content, null, 2)}</pre>
        </Disclosure>
      )}
      <ol className="relative mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {turns.map((t) => (
            <motion.li key={t.turn.n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="relative pl-7">
              <span className="absolute left-[9px] top-6 h-[calc(100%-12px)] w-px bg-white/[0.08]" />
              <span className="absolute left-0 top-0.5 flex size-[19px] items-center justify-center rounded-full bg-[#86efac]/15 text-[#86efac] ring-4 ring-night-2">
                <BrainCircuit className="size-3" />
              </span>
              {t.turn.kind === "model_turn" && (
                <div className="mb-2 flex flex-wrap items-center gap-x-2 text-[11.5px] text-white/45">
                  <span className="font-medium text-white/75">Nemotron · turn {t.turn.turn}</span>
                  <span className="tnum">{(t.turn.latency_ms / 1000).toFixed(1)}s</span>·<span className="tnum">{t.turn.tokens?.toLocaleString()} tok</span>
                </div>
              )}
              {t.turn.kind === "model_turn" && t.turn.reasoning && <Reasoning text={t.turn.reasoning} />}
              <div className="mt-2 space-y-2">{t.items.map((s) => <StepCard key={s.n} step={s} />)}</div>
            </motion.li>
          ))}
        </AnimatePresence>
        {run.status === "RUNNING" && (
          <li className="relative pl-7">
            <span className="absolute left-0 top-0.5 flex size-[19px] items-center justify-center rounded-full bg-[#86efac]/20">
              <span className="size-2 animate-ping rounded-full bg-[#86efac]" />
            </span>
            <div className="text-[12.5px] text-white/55">{run.stop_requested_by ? "Stopping after current turn…" : "Nemotron is deciding the next action…"}</div>
            <div className="mt-2 space-y-1.5">{[70, 52].map((w) => <div key={w} className="h-2 animate-pulse rounded bg-white/[0.06]" style={{ width: `${w}%` }} />)}</div>
          </li>
        )}
      </ol>
      <div ref={end} />
    </div>
  );
}

function groupTurns(steps: AgentStep[]) {
  const out: { turn: AgentStep; items: AgentStep[] }[] = [];
  for (const s of steps) {
    if (s.kind === "context") continue;
    if (s.kind === "model_turn" || !out.length) out.push({ turn: s, items: s.kind === "model_turn" ? [] : [s] });
    else out[out.length - 1].items.push(s);
  }
  return out;
}

const fmtArgs = (args: Record<string, unknown>) =>
  Object.entries(args).filter(([k]) => k !== "rationale").map(([k, v]) => `${k}: "${v}"`).join(", ");

function StepCard({ step }: { step: AgentStep }) {
  if (step.kind === "assessment") {
    const a = step.args;
    return (
      <div className="rounded-xl border border-[#86efac]/20 bg-[#86efac]/[0.06] p-3">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-[#c7f9d6]"><Target className="size-3.5" />Assessment · {a.severity}</div>
        <p className="text-[12.5px] leading-relaxed text-white/80">{a.threat_summary}</p>
        {a.objectives?.length > 0 && (
          <ol className="mt-2 space-y-0.5 text-[12px] text-white/60">
            {a.objectives.map((o, i) => <li key={i} className="flex gap-2"><span className="text-white/35 tnum">{i + 1}.</span>{o}</li>)}
          </ol>
        )}
      </div>
    );
  }
  if (step.kind === "tool_call") {
    return (
      <div className={cn("rounded-xl border p-3", step.replan ? "border-high/35 bg-high/[0.07]" : "border-white/[0.08] bg-white/[0.03]")}>
        <div className="flex flex-wrap items-center gap-2">
          {step.replan && <span className="inline-flex items-center gap-1 rounded-md bg-high/20 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#ffb37a]"><GitBranch className="size-3" />Replan</span>}
          <span className="inline-flex items-center gap-1.5 text-[12px] text-white/45"><Wrench className="size-3.5" />tool call</span>
          <code className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-white">{step.tool}({fmtArgs(step.args)})</code>
        </div>
        {step.args.rationale && <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/65">{step.args.rationale}</p>}
      </div>
    );
  }
  if (step.kind === "observation") {
    const r = step.result;
    return (
      <div className={cn("ml-4 rounded-xl border p-3",
        r.ok ? "border-ok/20 bg-ok/[0.06]" : r.code === "POLICY_BLOCKED" ? "border-[#c084fc]/30 bg-[#c084fc]/[0.07]" : "border-critical/30 bg-critical/[0.08]")}>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {r.ok ? <CheckCircle2 className="size-3.5 text-[#5fd394]" /> : r.code === "POLICY_BLOCKED" ? <ShieldBan className="size-3.5 text-[#d8b4fe]" /> : <XCircle className="size-3.5 text-[#ff8a8e]" />}
          <span className="text-white/45">observation</span>
          <span className={cn("font-mono font-semibold", r.ok ? "text-[#5fd394]" : r.code === "POLICY_BLOCKED" ? "text-[#d8b4fe]" : "text-[#ff8a8e]")}>{r.code}</span>
          {r.reference && <span className="rounded bg-white/[0.07] px-1 font-mono text-[10.5px] text-white/50">{r.reference}</span>}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/70">{r.message}</p>
        {!r.ok && <div className="mt-1.5 text-[11px] text-white/40">↳ fed back to Nemotron as a tool result</div>}
      </div>
    );
  }
  if (step.kind === "final" || step.kind === "escalation") {
    const a = step.args as Record<string, string | string[]>;
    const final = step.kind === "final";
    return (
      <div className={cn("rounded-xl border p-3", final ? "border-ok/30 bg-ok/[0.08]" : "border-high/35 bg-high/[0.08]")}>
        <div className={cn("mb-1 flex items-center gap-2 text-[12px] font-semibold", final ? "text-[#5fd394]" : "text-[#ffb37a]")}>
          {final ? <Flag className="size-3.5" /> : <Hand className="size-3.5" />}{final ? "complete_containment" : "request_human_intervention"}
        </div>
        <p className="text-[12.5px] leading-relaxed text-white/80">{final ? (a.summary as string) : `${a.reason} — ${a.blocking_issue}`}</p>
        {final && Array.isArray(a.residual_risks) && a.residual_risks.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[12px] text-white/55">{a.residual_risks.map((r) => <li key={r}>• {r}</li>)}</ul>
        )}
      </div>
    );
  }
  return null;
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen((o) => !o)} className="block w-full rounded-lg bg-white/[0.025] px-3 py-2 text-left">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/40">
        <ChevronRight className={cn("size-3 transition", open && "rotate-90")} />Model reasoning
      </span>
      <span className={cn("mt-1 block whitespace-pre-wrap text-[12px] italic leading-relaxed text-white/50", !open && "line-clamp-2")}>{text}</span>
    </button>
  );
}

function Disclosure({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.07]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-white/60 hover:text-white">
        {icon}{title}<ChevronRight className={cn("ml-auto size-3.5 transition", open && "rotate-90")} />
      </button>
      {open && <div className="max-h-64 overflow-auto px-3 pb-3">{children}</div>}
    </div>
  );
}

export const AGENT_STATUS_META: Record<string, { label: string; tone: "nightAccent" | "nightOk" | "nightCritical" | "night" }> = {
  RUNNING: { label: "Agent running", tone: "nightAccent" },
  COMPLETED: { label: "Agent completed", tone: "nightOk" },
  HUMAN_REQUIRED: { label: "Human required", tone: "nightCritical" },
  STOPPED: { label: "Stopped by operator", tone: "night" },
  ERROR: { label: "Agent error", tone: "nightCritical" },
  MAX_TURNS: { label: "Turn budget exhausted", tone: "nightCritical" },
};

