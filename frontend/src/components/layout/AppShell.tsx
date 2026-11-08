import { AnimatePresence, motion } from "motion/react";
import {
  Activity, BrainCircuit, ChevronDown, Database, FileText, LayoutGrid, Menu, PhoneCall, Radar, RotateCcw, ScanEye, Siren, Sparkles, X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LiveDot } from "@/components/domain";
import { useDemo } from "@/lib/demo";
import { cn } from "@/lib/utils";
import { BrandMark, Wordmark } from "./Brand";

const NAV = [
  { group: "Overview", items: [{ to: "/command", label: "Command Center", icon: LayoutGrid, end: true }] },
  {
    group: "Lifecycle", items: [
      { to: "/proactive", label: "Proactive Defense", icon: Radar, phase: "Before" },
      { to: "/live-call", label: "Live Call Defense", icon: PhoneCall, phase: "During" },
      { to: "/war-room", label: "Incident War Room", icon: Siren, phase: "After" },
    ],
  },
  { group: "NVIDIA Nemotron", items: [{ to: "/evaluation", label: "Agent Evaluation", icon: BrainCircuit }] },
  {
    group: "Trust", items: [
      { to: "/privacy", label: "Privacy Sieve", icon: ScanEye },
      { to: "/reports", label: "Legal & Forensics", icon: FileText },
    ],
  },
];

function SystemStatus() {
  const { health, healthError } = useDemo();
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-[12px]">
      <div className="mb-2.5 flex items-center gap-2 font-medium text-ink">
        <LiveDot color={healthError ? "var(--color-critical)" : "var(--color-ok)"} />
        {healthError ? "Gateway offline" : "Gateway online"}
      </div>
      <div className="space-y-1.5 text-muted">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><Database className="size-3" />Store</span>
          <span className="font-medium text-ink-2">{health ? (health.database === "mongodb" ? "MongoDB" : "In-memory") : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><Sparkles className="size-3" />AI</span>
          <span className={cn("font-medium", health?.ai_engine === "nemotron" ? "text-ok" : "text-ink-2")}>
            {health ? (health.agent.enabled ? health.agent.default_model.replace("nvidia/", "").replace(/-\d+b.*$/, "") : "Not configured") : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><Activity className="size-3" />Carrier</span>
          <span className="font-medium text-ink-2">Simulated</span>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="scroll-thin flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <NavLink to="/" className="flex items-center gap-2.5 px-2" onClick={onNavigate}>
        <BrandMark size={36} />
        <div className="leading-tight">
          <Wordmark className="text-[14px]" />
          <div className="text-[11px] text-muted">Scam defense · 24/7</div>
        </div>
      </NavLink>
      <nav className="flex flex-1 flex-col gap-5">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="mb-1.5 px-2.5 text-[11px] font-medium text-faint">{g.group}</div>
            <div className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={"end" in item ? item.end : false} onClick={onNavigate}
                  className={({ isActive }) => cn(
                    "group relative flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] font-medium transition-colors",
                    isActive ? "bg-white/[0.06] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(255,255,255,0.06)]" : "text-ink-2 hover:bg-white/[0.035] hover:text-ink")}>
                  {({ isActive }) => (<>
                    <item.icon className={cn("size-4", isActive ? "text-accent" : "text-muted group-hover:text-ink-2")} />
                    <span className="flex-1">{item.label}</span>
                    {"phase" in item && <span className="text-[10.5px] font-medium text-faint">{item.phase}</span>}
                  </>)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="hidden lg:block"><DemoStory inline /></div>
      <SystemStatus />
    </div>
  );
}

function DemoStory({ inline }: { inline?: boolean }) {
  const { steps, reset, incidentId } = useDemo();
  const [open, setOpen] = useState(false);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <div className={inline ? "w-full" : "fixed bottom-5 right-5 z-40 w-[300px] max-w-[calc(100vw-2.5rem)] lg:hidden"}>
      <motion.div layout className="overflow-hidden rounded-2xl border border-line-strong bg-[#0c0f0d]/90 shadow-[var(--shadow-lift)] backdrop-blur-xl">
        <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          <div className="relative size-8 shrink-0">
            <svg viewBox="0 0 36 36" className="size-8 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-subtle)" strokeWidth="3.5" />
              <motion.circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-accent)" strokeWidth="3.5" strokeLinecap="round"
                strokeDasharray={94.2} animate={{ strokeDashoffset: 94.2 * (1 - done / steps.length) }} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tnum">{done}/8</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold">Demo story</div>
            <div className="truncate text-[11.5px] text-muted">{next ? `Next: ${next.label}` : "Complete — incident resolved"}</div>
          </div>
          <ChevronDown className={cn("size-4 text-muted transition-transform", !open && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}>
              <ol className="space-y-0.5 border-t border-line px-2 py-2">
                {steps.map((s, i) => (
                  <li key={s.key}>
                    <NavLink to={s.href} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-subtle">
                      <span className={cn("flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tnum",
                        s.done ? "bg-accent text-on-ink" : s === next ? "bg-accent-soft text-accent ring-1 ring-accent/40" : "bg-subtle text-muted")}>
                        {s.done ? "✓" : i + 1}
                      </span>
                      <span className={cn(s.done ? "text-ink" : "text-muted")}>{s.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ol>
              {(done > 0 || incidentId) && (
                <button onClick={reset} className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-[12px] font-medium text-muted hover:text-ink">
                  <RotateCcw className="size-3" /> Reset story
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] border-r border-line bg-canvas lg:block">
        <Sidebar />
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2"><BrandMark size={30} /><Wordmark className="text-[14px]" /></div>
        <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 hover:bg-subtle"><Menu className="size-5" /></button>
      </header>
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-[280px] bg-canvas lg:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}>
              <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 hover:bg-subtle"><X className="size-4" /></button>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <main className="lg:pl-[256px]">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname.split("/")[1]} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }} className="mx-auto max-w-[1360px] px-5 pb-28 pt-8 md:px-10 md:pt-12">
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      <DemoStory />
    </div>
  );
}
