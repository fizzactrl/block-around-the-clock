import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BrainCircuit, CheckCircle2, CircleStop, CreditCard, Cpu, FileText, Fingerprint,
  FlaskConical, KeyRound, Landmark, Link2, Lock, PhoneOff, RotateCw, ShieldCheck, ShieldOff, Siren, Smartphone, TriangleAlert, Zap,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AGENT_STATUS_META, AgentTrace } from "@/components/AgentTrace";
import { ActionStatusIcon, ErrorState, LiveDot, RiskRing, SeverityBadge, SimulatedTag, Skeleton, StatusBadge } from "@/components/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/demo";
import { PII_LABELS } from "@/lib/tokenizer";
import type { AuditEntry, ContainmentAction, IncidentStatusPayload, IncidentSummary } from "@/lib/types";
import { clockTime, cn, mmss, timeAgo } from "@/lib/utils";

export default function WarRoom() {
  const { id } = useParams();
  const { incidentId } = useDemo();
  const navigate = useNavigate();
  useEffect(() => { if (!id && incidentId) navigate(`/war-room/${incidentId}`, { replace: true }); }, [id, incidentId, navigate]);
  return id ? <IncidentRoom id={id} /> : <IncidentPicker />;
}

/* ───────────────────────────── Incident picker ───────────────────────────── */

function IncidentPicker() {
  const [items, setItems] = useState<IncidentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.incidents().then(setItems).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorState error={error} />;
  return (
    <div>
      <div className="mb-8 max-w-2xl">
        <div className="eyebrow mb-2.5"><span className="text-ink">After</span> · Incident War Room</div>
        <h1 className="display text-[40px] leading-[1.05]">Select an incident</h1>
        <p className="mt-3 text-[15px] text-muted">You can also start from a simulated call. Escalating the call creates an incident and opens it here, where the Nemotron agent handles containment.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {!items && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {items?.map((i) => (
          <Link key={i.id} to={`/war-room/${i.id}`} className="card group flex flex-col gap-4 p-5 transition hover:shadow-[var(--shadow-lift)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold group-hover:text-accent">{i.title}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">{i.id} · {i.threat_type}</div>
              </div>
              <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={i.severity} /><StatusBadge status={i.status} />
              <span className="ml-auto text-[12px] text-muted">{timeAgo(i.created_at)}</span>
            </div>
          </Link>
        ))}
        <Link to="/live-call" className="flex min-h-28 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[13.5px] font-medium text-muted transition hover:border-ink hover:text-ink">
          <Siren className="size-4" />Start from a simulated call
        </Link>
      </div>
    </div>
  );
}

/* ───────────────────────────── Incident room ─────────────────────────────── */

const MANUAL: { action: string; params?: Record<string, string>; label: string; icon: typeof Lock }[] = [
  { action: "LOCK_SIM", label: "Lock SIM / eSIM", icon: Smartphone },
  { action: "BLOCK_PORT_OUT", label: "Block port-out", icon: PhoneOff },
  { action: "REVOKE_SESSIONS", params: { scope: "all" }, label: "Revoke all sessions", icon: ShieldOff },
  { action: "RESET_CREDENTIALS", label: "Force credential reset", icon: KeyRound },
  { action: "ALERT_BANK_FRAUD", label: "Alert bank fraud desk", icon: Landmark },
  { action: "ENABLE_CALL_SHIELD", label: "Enable call shield", icon: ShieldCheck },
  { action: "PLACE_FRAUD_ALERT", params: { bureau: "equifax" }, label: "Fraud alert via Equifax (all bureaus)", icon: CreditCard },
];

function IncidentRoom({ id }: { id: string }) {
  const [data, setData] = useState<IncidentStatusPayload | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [engaging, setEngaging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { mark, health } = useDemo();
  const [model, setModel] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => { if (health && !model) setModel(health.agent.default_model); }, [health, model]);

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.status(id), api.timeline(id)]);
      setData(s);
      setAudit(t.events);
      setError(null);
      return s;
    } catch (e) { setError((e as Error).message); return null; }
  }, [id]);

  const running = data?.agent?.status === "RUNNING" || data?.incident.status === "CONTAINING";
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, running ? 700 : 4000);
    return () => clearInterval(t);
  }, [refresh, running]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const engage = async () => {
    setEngaging(true);
    try {
      await api.startAgent(id, model || undefined);
      mark({ incidentId: id });
      toast.success("Nemotron agent engaged");
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setEngaging(false); }
  };

  const stopAgent = async () => {
    if (!data?.agent) return;
    try { await api.stopAgent(data.agent.id); toast("Stop requested — agent halts after the current turn"); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const manual = async (action: string, params?: Record<string, string>) => {
    setBusy(action + JSON.stringify(params ?? {}));
    try { setData(await api.manualAction(id, action, params)); toast.success("Emergency action queued"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const retry = async (a: ContainmentAction) => {
    setBusy(a.id);
    try { setData(await api.retry(id, a.id)); toast(`Retrying ${a.label}`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  if (error && !data) return <ErrorState error={error} onRetry={refresh} />;
  if (!data) return <Skeleton className="h-[640px] rounded-3xl" />;

  const { incident: inc, actions, progress, agent: run } = data;
  const elapsed = now - new Date(inc.created_at).getTime();
  const done = !running && (inc.status === "CONTAINED" || inc.status === "ATTENTION_REQUIRED");
  const agentEnabled = health?.agent.enabled ?? true;
  const conditions = (inc.sim_env?.conditions ?? {}) as { port_out_pending?: boolean; bureau_outage?: string[]; bureau_outage_first_attempt?: boolean };
  const legacy = !run && actions.length > 0;
  const replans = run?.steps.filter((s) => s.kind === "tool_call" && s.replan).length ?? 0;
  const toolCalls = run?.steps.filter((s) => s.kind === "tool_call").length ?? 0;

  return (
    <div className="relative -mx-2 overflow-hidden rounded-[28px] bg-night p-4 text-white shadow-[0_40px_100px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06),0_0_120px_-60px_rgba(74,222,128,0.35)] md:-mx-4 md:p-7">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[280px] bg-[radial-gradient(ellipse_at_30%_0%,rgba(74,222,128,0.1),transparent_60%)]" />
      <div className="relative">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link to="/war-room" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-white/50 hover:text-white"><ArrowLeft className="size-3.5" />All incidents</Link>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-white/45">
              <LiveDot color={done ? "var(--color-ok)" : "var(--color-critical)"} />After · Incident War Room
            </span>
            <SimulatedTag night label="Simulated adapters" />
          </div>
          <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[38px]">{inc.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-white/55">
            <span className="font-medium text-white/80">{inc.id}</span>·<span>{inc.threat_type}</span>·<span>source {inc.source}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={inc.severity} night />
            <NightStatus status={inc.status} />
            {run && <Badge tone={AGENT_STATUS_META[run.status].tone}>{run.status === "RUNNING" && <LiveDot color="#86efac" />}{AGENT_STATUS_META[run.status].label}</Badge>}
            <Badge tone="night" className="tnum">T+{elapsed > 3600000 ? `${Math.floor(elapsed / 3600000)}h ${Math.floor((elapsed % 3600000) / 60000)}m` : mmss(elapsed)}</Badge>
            <Badge tone="night">{inc.privacy.total_removed} values tokenized</Badge>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <RiskRing value={inc.risk_score} size={104} stroke={8} night label="Risk" />
          <RiskRing value={progress.percent} size={104} stroke={8} night label="Succeeded" color="var(--color-ok)" />
          <div className="hidden flex-col gap-2 sm:flex">
            <Button variant="nightPrimary" disabled={!done} onClick={() => navigate(`/reports/${id}`)}><FileText />Generate report</Button>
            <Tip content="Refresh state from the orchestrator"><Button variant="night" onClick={refresh}><RotateCw />Sync</Button></Tip>
          </div>
        </div>
      </div>

      {/* ── Control status tiles ─────────────────────────────────────── */}
      <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile title="SIM / eSIM lock" icon={<Smartphone />} actions={actions.filter((a) => a.action === "LOCK_SIM" || a.action === "BLOCK_PORT_OUT")} doneLabel="Locked" />
        <CreditTile actions={actions.filter((a) => a.action === "FREEZE_CREDIT" || a.action === "PLACE_FRAUD_ALERT")} />
        <StatusTile title="Session revocation" icon={<Fingerprint />} actions={actions.filter((a) => a.action === "REVOKE_SESSIONS" || a.action === "RESET_CREDENTIALS")} doneLabel="Revoked" />
        <StatusTile title="Financial & call shield" icon={<Landmark />} actions={actions.filter((a) => a.action === "ALERT_BANK_FRAUD" || a.action === "ENABLE_CALL_SHIELD")} doneLabel="Active" />
      </div>

      {/* ── Main grid ────────────────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 xl:grid-cols-[0.85fr_1.5fr_0.8fr]">
        {/* Agent console */}
        <div className="space-y-3">
          <NightCard>
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#76b900]/20 text-[#a3e635]"><BrainCircuit className="size-4" /></span>
              <div>
                <div className="text-[14px] font-semibold">Nemotron containment agent</div>
                <div className="text-[11.5px] text-white/45">Decide → call tool → observe → replan</div>
              </div>
            </div>

            {!run ? (
              <div className="space-y-4">
                <p className="text-[12.5px] leading-relaxed text-white/60">
                  Engaging hands the sanitized incident to NVIDIA Nemotron. It assesses, then selects one allowlisted tool at a time.
                  Each call runs through a validated Flask adapter, and the real result is fed back for the next decision.
                </p>
                {legacy && <div className="rounded-lg bg-white/[0.04] p-2.5 text-[11.5px] text-white/50">This historical seed incident was contained by the deterministic playbook before the agent existed.</div>}
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">Model</span>
                  <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!health}
                    className="h-9 w-full rounded-[10px] border border-white/10 bg-night-3 px-2.5 text-[13px] text-white outline-none focus:border-white/30">
                    {health && Object.entries(health.agent.models).map(([mid, label]) => <option key={mid} value={mid}>{label}</option>)}
                  </select>
                </label>
                {agentEnabled ? (
                  <Button variant="danger" size="lg" className="w-full" onClick={engage} loading={engaging}><Zap />Engage Nemotron agent</Button>
                ) : (
                  <div className="flex gap-2 rounded-xl bg-critical/10 p-3 text-[12px] text-[#ff8a8e]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    NVIDIA_API_KEY is not configured. The agent will not run, and no mock is substituted.</div>
                )}
                <p className="text-[11px] leading-relaxed text-white/35">Engaging is your authorization. The agent can only call allowlisted tools, and the policy engine blocks invalid or repeated failing calls.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <Stat k="Model" v={(run.served_model || run.model).replace("nvidia/", "")} wide />
                  <Stat k="Model turns" v={run.turns} />
                  <Stat k="Tool calls" v={toolCalls} />
                  <Stat k="Replans" v={replans} accent={replans > 0} />
                  <Stat k="Tokens" v={run.usage.total_tokens.toLocaleString()} />
                  <Stat k="Model time" v={`${(run.model_latency_ms / 1000).toFixed(1)}s`} wide />
                </div>
                {run.status === "RUNNING" && <Button variant="night" className="w-full" onClick={stopAgent} disabled={!!run.stop_requested_by}><CircleStop />Stop agent</Button>}
                <Outcome run={run} />
                {run.status !== "RUNNING" && (
                  <Button variant="night" className="w-full" onClick={engage} loading={engaging} disabled={!agentEnabled}><RotateCw />Run agent again</Button>
                )}
              </div>
            )}
          </NightCard>

          <NightCard>
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><FlaskConical className="size-3.5 text-white/50" />Simulated environment</div>
            <p className="mb-2.5 text-[11.5px] text-white/40">Real-world conditions the adapters model for this incident. The agent isn't told about them; it discovers them from tool results.</p>
            {!conditions.port_out_pending && !conditions.bureau_outage?.length && !conditions.bureau_outage_first_attempt ? (
              <div className="text-[12px] text-white/55">All adapters healthy.</div>
            ) : (
              <ul className="space-y-1.5 text-[12px] text-white/70">
                {conditions.port_out_pending && <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-high" />Fraudulent port-out already in flight</li>}
                {conditions.bureau_outage?.map((b) => <li key={b} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-critical" />Sustained {b === "transunion" ? "TransUnion" : b} API outage</li>)}
                {conditions.bureau_outage_first_attempt && <li className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-medium" />Transient TransUnion error on first attempt</li>}
              </ul>
            )}
          </NightCard>
        </div>

        {/* Agent trace */}
        <NightCard className="min-h-[520px]">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-semibold">Agent trace</div>
              <div className="text-[11.5px] text-white/45">Decisions, tool calls, observations and replanning, live from Nemotron</div>
            </div>
            {run?.status === "RUNNING" && <Badge tone="nightAccent"><LiveDot color="#86efac" />Live</Badge>}
          </div>
          {run ? <AgentTrace run={run} maxHeight={1080} /> : (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-[13px] text-white/40">
              <Cpu className="size-7 text-white/20" />Engage the agent to watch it reason and act.
            </div>
          )}
        </NightCard>

        {/* Executions + manual controls */}
        <div className="space-y-3">
          <NightCard>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[14px] font-semibold">Adapter executions</div>
              <span className="text-[11.5px] text-white/40 tnum">{progress.succeeded}✓ {progress.failed}✗</span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div className="h-full rounded-full bg-ok" animate={{ width: `${progress.percent}%` }} />
            </div>
            {!actions.length ? <div className="py-4 text-center text-[12px] text-white/35">No tool executions yet.</div> : (
              <ol className="scroll-night max-h-[330px] space-y-1.5 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {actions.map((a) => (
                    <motion.li key={a.id} layout initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}
                      className={cn("rounded-lg border px-2.5 py-2", a.status === "FAILED" ? "border-critical/30 bg-critical/[0.06]" : "border-white/[0.06]")}>
                      <div className="flex items-center gap-2">
                        <ActionStatusIcon status={a.status} className="size-4" />
                        <span className="flex-1 truncate text-[12.5px] font-medium">{a.label}</span>
                        <span className="text-[10.5px] text-white/35">{a.requested_by === "nemotron-agent" ? "agent" : a.requested_by.startsWith("operator") ? "manual" : "plan"}</span>
                      </div>
                      {a.result && !a.result.ok && <div className="mt-1 line-clamp-2 pl-6 text-[11px] text-[#ff8a8e]">{(a.result as { code?: string }).code}: {a.result.message}</div>}
                      {a.status === "FAILED" && !running && (
                        <button onClick={() => retry(a)} disabled={busy === a.id} className="ml-6 mt-1.5 text-[11.5px] font-medium text-white/70 underline-offset-2 hover:underline">Manual retry</button>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            )}
          </NightCard>
          <NightCard>
            <div className="mb-1 text-[14px] font-semibold">Manual emergency controls</div>
            <div className="mb-3 text-[11.5px] text-white/45">Human override, policy-validated and audit-logged.</div>
            <div className="grid grid-cols-1 gap-1.5">
              {MANUAL.map((m) => (
                <button key={m.action} onClick={() => manual(m.action, m.params)} disabled={!!busy || running}
                  className="group flex items-center gap-2.5 rounded-lg border border-white/[0.07] px-3 py-1.5 text-left text-[12.5px] font-medium text-white/80 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-white disabled:opacity-40">
                  <m.icon className="size-3.5 text-white/50 group-hover:text-white" />{m.label}
                </button>
              ))}
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {(["equifax", "experian", "transunion"] as const).map((b) => (
                  <button key={b} onClick={() => manual("FREEZE_CREDIT", { bureau: b })} disabled={!!busy || running}
                    className="rounded-lg border border-white/[0.07] px-2 py-1.5 text-[11.5px] font-medium capitalize text-white/70 transition hover:border-white/20 hover:text-white disabled:opacity-40">
                    <CreditCard className="mx-auto mb-0.5 size-3.5 text-white/45" />{b === "transunion" ? "TransUnion" : b}
                  </button>
                ))}
              </div>
            </div>
          </NightCard>
          <NightCard>
            <div className="mb-2 text-[13px] font-semibold">Privacy ledger</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {Object.entries(inc.privacy.entities_removed).map(([k, n]) => <Badge key={k} tone="night">{PII_LABELS[k] ?? k} · {n}</Badge>)}
            </div>
            <div className="space-y-1 text-[12px] text-white/55">
              <div className="flex justify-between"><span>Server residual</span><span className="text-white/80">{Object.values(inc.privacy.server_residual).reduce((a, b) => a + b, 0)}</span></div>
              <div className="flex justify-between"><span>Raw PII sent to Nemotron</span><span className="text-[#5fd394]">None</span></div>
            </div>
          </NightCard>
        </div>
      </div>

      {/* ── Evidence + audit trail ───────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <NightCard>
          <div className="mb-3 text-[14px] font-semibold">Sanitized evidence</div>
          <div className="scroll-night max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {inc.sanitized_transcript.map((l, i) => (
              <div key={i} className="text-[12.5px] leading-relaxed">
                <span className="mr-2 text-[11px] font-medium uppercase tracking-wide text-white/35">{l.speaker}</span>
                <span className="text-white/75">{l.text.split(/(\[[A-Z]+_[0-9A-F]{6}\])/g).map((p, j) =>
                  /^\[[A-Z]+_/.test(p) ? <span key={j} className="rounded bg-accent/20 px-1 text-[11.5px] text-[#bbf7d0]">{p}</span> : p)}</span>
              </div>
            ))}
            {inc.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">{inc.signals.map((s) => <Badge key={s.key} tone="nightCritical">{s.label}</Badge>)}</div>
            )}
          </div>
        </NightCard>
        <NightCard>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[14px] font-semibold">Incident audit trail</div>
            <Tip content="Each entry includes the SHA-256 of its predecessor. Tamper-evident, not immutable storage.">
              <span className="flex cursor-help items-center gap-1.5 text-[11.5px] text-white/50"><Link2 className="size-3.5" />Hash-chained · {audit.length}</span>
            </Tip>
          </div>
          <ol className="scroll-night max-h-[300px] overflow-y-auto pr-1">
            {[...audit].reverse().map((e) => (
              <li key={e.id} className="grid grid-cols-[64px_1fr_auto] gap-3 border-b border-white/[0.05] py-2 text-[12px] last:border-0">
                <span className="text-white/40 tnum">{clockTime(e.ts)}</span>
                <div className="min-w-0">
                  <div className={cn("leading-snug", /failed|rejected|blocked|error/.test(e.event_type) ? "text-[#ff8a8e]" : e.event_type === "agent.replan" ? "text-[#ffb37a]" : "text-white/80")}>{e.summary}</div>
                  <div className="text-[11px] text-white/35">{e.event_type} · {e.actor}</div>
                </div>
                <Tip content={`hash ${e.hash}\nprev ${e.prev_hash}`}><span className="cursor-help font-mono text-[10.5px] text-white/30">#{e.hash.slice(0, 6)}</span></Tip>
              </li>
            ))}
          </ol>
        </NightCard>
      </div>
      <div className="mt-4 flex justify-center sm:hidden">
        <Button variant="nightPrimary" disabled={!done} onClick={() => navigate(`/reports/${id}`)}><FileText />Generate report</Button>
      </div>
      </div>
    </div>
  );
}

function Outcome({ run }: { run: NonNullable<IncidentStatusPayload["agent"]> }) {
  const o = run.outcome;
  if (run.status === "RUNNING") return null;
  if (run.status === "ERROR") return (
    <div className="rounded-xl bg-critical/10 p-3 text-[12px] text-[#ff8a8e]"><div className="mb-1 flex items-center gap-1.5 font-semibold"><TriangleAlert className="size-3.5" />Nemotron run failed</div>{run.error}<div className="mt-1 text-white/40">No mock was substituted.</div></div>
  );
  const unresolved = o?.unresolved_failures ?? [];
  const clean = run.status === "COMPLETED" && !unresolved.length;
  return (
    <div className={cn("rounded-xl p-3 text-[12px]", clean ? "bg-ok/10" : "bg-high/10")}>
      <div className={cn("mb-1 flex items-center gap-1.5 font-semibold", clean ? "text-[#5fd394]" : "text-[#ffb37a]")}>
        {clean ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
        {run.status === "COMPLETED" ? (unresolved.length ? "Agent finished — server guard flagged gaps" : "Containment complete") : AGENT_STATUS_META[run.status].label}
      </div>
      {o?.reason && <p className="text-white/70">{o.reason}</p>}
      {unresolved.length > 0 && <p className="mt-1 text-white/60">Unresolved: {unresolved.join(", ")}</p>}
    </div>
  );
}

function Stat({ k, v, wide, accent }: { k: string; v: React.ReactNode; wide?: boolean; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg bg-white/[0.04] px-2.5 py-2", wide && "col-span-2")}>
      <div className="text-[10.5px] text-white/40">{k}</div>
      <div className={cn("truncate text-[13px] font-medium tnum", accent ? "text-[#ffb37a]" : "text-white/90")}>{v}</div>
    </div>
  );
}

function NightCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/[0.07] bg-night-2 p-5", className)}>{children}</div>;
}

function NightStatus({ status }: { status: IncidentStatusPayload["incident"]["status"] }) {
  const map = {
    DETECTED: ["Detected · awaiting agent", "nightCritical"], ANALYZED: ["Analyzed", "nightAccent"],
    CONTAINING: ["Containing", "nightAccent"], CONTAINED: ["Contained", "nightOk"], ATTENTION_REQUIRED: ["Attention required", "nightCritical"],
  } as const;
  const [label, tone] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function tileState(actions: ContainmentAction[]) {
  if (!actions.length) return "idle";
  const latest = new Map<string, ContainmentAction>();
  actions.forEach((a) => latest.set(a.action + JSON.stringify(a.params), a));
  const l = [...latest.values()];
  if (l.some((a) => a.status === "EXECUTING")) return "executing";
  if (l.some((a) => a.status === "FAILED")) return l.some((a) => a.status === "SUCCEEDED") ? "partial" : "failed";
  if (l.every((a) => a.status === "SUCCEEDED")) return "done";
  return "queued";
}

const TILE_TONE = {
  done: "border-ok/25 bg-ok/[0.07]", failed: "border-critical/30 bg-critical/[0.07]", partial: "border-high/30 bg-high/[0.06]",
  executing: "border-accent/30 bg-accent/[0.07]", queued: "border-white/[0.07] bg-night-2", idle: "border-white/[0.07] bg-night-2",
};

function StatusTile({ title, icon, actions, doneLabel }: { title: string; icon: React.ReactNode; actions: ContainmentAction[]; doneLabel: string }) {
  const st = tileState(actions);
  const label = { idle: "Not requested", queued: "Queued", executing: "Executing…", done: doneLabel, failed: "Failed", partial: "Partial" }[st];
  return (
    <motion.div layout className={cn("rounded-2xl border p-4 transition-colors duration-500", TILE_TONE[st])}>
      <div className="flex items-center justify-between text-white/50 [&_svg]:size-4">{icon}
        {st === "done" ? <CheckCircle2 className="text-[#5fd394]" /> : st === "executing" ? <RotateCw className="animate-spin text-[#86efac]" /> : st === "failed" || st === "partial" ? <TriangleAlert className="text-[#ff8a8e]" /> : <Lock className="opacity-40" />}
      </div>
      <div className="mt-4 text-[12px] text-white/50">{title}</div>
      <div className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em]">{label}</div>
      <div className="mt-1 text-[11px] text-white/35">{actions.length ? `${actions.filter((a) => a.status === "SUCCEEDED").length}/${actions.length} executions` : "—"}</div>
    </motion.div>
  );
}

function CreditTile({ actions }: { actions: ContainmentAction[] }) {
  const bureaus = ["equifax", "experian", "transunion"];
  const alert = actions.find((a) => a.action === "PLACE_FRAUD_ALERT" && a.status === "SUCCEEDED");
  const freezes = actions.filter((a) => a.action === "FREEZE_CREDIT");
  const st = tileState(actions);
  const frozen = new Set(freezes.filter((a) => a.status === "SUCCEEDED").map((a) => a.params.bureau));
  const label = st === "idle" ? "Not requested" : st === "executing" ? "Executing…" :
    frozen.size === 3 ? "Frozen" : alert ? (frozen.size ? `${frozen.size} frozen + alert` : "Fraud alert") : st === "done" ? "Frozen" : st === "failed" ? "Failed" : "Partial";
  return (
    <motion.div layout className={cn("rounded-2xl border p-4 transition-colors duration-500", TILE_TONE[alert && st !== "executing" ? "done" : st])}>
      <div className="flex items-center justify-between text-white/50"><CreditCard className="size-4" />
        <div className="flex gap-1">
          {bureaus.map((b) => {
            const a = [...freezes].reverse().find((x) => x.params.bureau === b);
            return (
              <Tip key={b} content={`${b}: ${a ? a.status.toLowerCase() : "not requested"}`}>
                <span className={cn("size-2 rounded-full", !a ? "bg-white/15" : a.status === "SUCCEEDED" ? "bg-ok" : a.status === "FAILED" ? "bg-critical" : a.status === "EXECUTING" ? "animate-pulse bg-accent" : "bg-white/40")} />
              </Tip>
            );
          })}
        </div>
      </div>
      <div className="mt-4 text-[12px] text-white/50">Credit bureau protection</div>
      <div className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em]">{label}</div>
      <div className="mt-1 text-[11px] text-white/35">{actions.length ? `${actions.filter((a) => a.status === "SUCCEEDED").length}/${actions.length} executions` : "—"}</div>
    </motion.div>
  );
}
