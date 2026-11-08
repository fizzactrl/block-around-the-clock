import { motion } from "motion/react";
import { ArrowUpRight, BrainCircuit, CheckCircle2, CircleDashed, FlaskConical, Loader2, Play, PlayCircle, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AgentTrace } from "@/components/AgentTrace";
import { ErrorState, PageHeader, Skeleton } from "@/components/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/demo";
import type { EvalResult, EvalScenario } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

const CONDITION_LABEL = (c: Record<string, unknown>) => {
  const out: string[] = [];
  if (c.port_out_pending) out.push("Port-out in flight");
  (c.bureau_outage as string[] | undefined)?.forEach((b) => out.push(`${b === "transunion" ? "TransUnion" : b} outage`));
  return out.length ? out : ["All adapters healthy"];
};

export default function Evaluation() {
  const { health } = useDemo();
  const [scenarios, setScenarios] = useState<EvalScenario[] | null>(null);
  const [history, setHistory] = useState<EvalResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [active, setActive] = useState<Record<string, EvalResult>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const alive = useRef(true);

  useEffect(() => { if (health && !model) setModel(health.agent.default_model); }, [health, model]);
  useEffect(() => {
    alive.current = true;
    Promise.all([api.evalScenarios(), api.evalRuns()]).then(([s, h]) => {
      setScenarios(s);
      setHistory(h);
      const latest: Record<string, EvalResult> = {};
      [...h].reverse().forEach((r) => (latest[r.scenario_id] = r));
      setActive(latest);
      if (h[0]) setSelected(h[0].id);
    }).catch((e) => setError(e.message));
    return () => { alive.current = false; };
  }, []);

  const runOne = useCallback(async (sid: string) => {
    let ev = await api.runEval(sid, model || undefined);
    setActive((a) => ({ ...a, [sid]: ev }));
    setSelected(ev.id);
    while (alive.current && ev.status === "RUNNING") {
      await new Promise((r) => setTimeout(r, 900));
      ev = await api.evalRun(ev.id);
      setActive((a) => ({ ...a, [sid]: ev }));
    }
    setHistory((h) => [ev, ...h.filter((x) => x.id !== ev.id)]);
    return ev;
  }, [model]);

  const run = async (sid: string) => {
    try {
      const ev = await runOne(sid);
      toast[ev.grade?.verdict === "PASS" ? "success" : "warning"](`${ev.scenario.title}: ${ev.grade?.verdict} (${ev.grade?.passed}/${ev.grade?.total})`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const runAll = async () => {
    if (!scenarios) return;
    setBatch(true);
    try { for (const s of scenarios) await runOne(s.id); toast.success("Evaluation suite finished"); }
    catch (e) { toast.error((e as Error).message); } finally { setBatch(false); }
  };

  if (error) return <ErrorState error={error} />;
  const sel = Object.values(active).find((r) => r.id === selected) ?? history.find((r) => r.id === selected);
  const anyRunning = Object.values(active).some((r) => r.status === "RUNNING");
  const done = Object.values(active).filter((r) => r.grade);
  const totalChecks = done.reduce((s, r) => s + (r.grade?.total ?? 0), 0);
  const passedChecks = done.reduce((s, r) => s + (r.grade?.passed ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow={<><BrainCircuit className="size-3" /> NVIDIA Nemotron · Agent evaluation</>}
        title="Agent evaluation" highlight="evaluation"
        description="Each scenario uses fixed evidence and a fixed simulated environment, runs the Nemotron agent against the live NVIDIA API, and grades the recorded actions. The checks confirm that the agent assessed the incident first, acted in proportion to the risk, noticed failed steps, and reported its outcome accurately."
        actions={<>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!health || batch || anyRunning}
            className="h-9 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] font-medium outline-none focus:border-accent">
            {health && Object.entries(health.agent.models).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <Button onClick={runAll} loading={batch} disabled={!health?.agent.enabled || anyRunning}><PlayCircle />Run all scenarios</Button>
        </>}
      />

      {health && !health.agent.enabled && (
        <div className="mb-5 rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-[#ff8a8e]">
          NVIDIA_API_KEY is not configured. Evaluations run only against the real Nemotron API; no mock is substituted.
        </div>
      )}

      {done.length > 0 && (
        <Card className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <div><div className="text-[12px] text-muted">Checks passed</div><div className="text-[24px] font-semibold tracking-[-0.03em] tnum">{passedChecks}/{totalChecks}</div></div>
          <div><div className="text-[12px] text-muted">Scenarios passing</div><div className="text-[24px] font-semibold tracking-[-0.03em] tnum">{done.filter((r) => r.grade?.verdict === "PASS").length}/{scenarios?.length ?? 0}</div></div>
          <div><div className="text-[12px] text-muted">Replans observed</div><div className="text-[24px] font-semibold tracking-[-0.03em] tnum">{done.reduce((s, r) => s + (r.run?.steps.filter((x) => x.kind === "tool_call" && x.replan).length ?? 0), 0)}</div></div>
          <div><div className="text-[12px] text-muted">Tokens</div><div className="text-[24px] font-semibold tracking-[-0.03em] tnum">{done.reduce((s, r) => s + (r.grade?.tokens ?? 0), 0).toLocaleString()}</div></div>
          <div className="ml-auto text-[12px] text-muted">Every result below came from a live NVIDIA API call.</div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {!scenarios && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
        {scenarios?.map((s, idx) => {
          const r = active[s.id];
          const running = r?.status === "RUNNING";
          return (
            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
              <Card className={cn("flex h-full flex-col p-5 transition", selected === r?.id && "ring-2 ring-accent/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow mb-1">Scenario {idx + 1}</div>
                    <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{s.title}</h3>
                  </div>
                  {r?.grade ? <Verdict v={r.grade.verdict} /> : running ? <Badge tone="accent"><Loader2 className="animate-spin" />Running</Badge> : <Badge tone="outline">Not run</Badge>}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{s.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {CONDITION_LABEL(s.conditions).map((c) => <Badge key={c} tone={c.includes("healthy") ? "outline" : "high"}><FlaskConical />{c}</Badge>)}
                </div>
                <div className="mt-3 rounded-xl bg-subtle p-3 text-[12.5px] leading-relaxed text-ink-2"><span className="font-semibold text-ink">Expected · </span>{s.expect}</div>

                {r?.grade && (
                  <ul className="mt-3 space-y-1">
                    {r.grade.checks.map((c) => (
                      <li key={c.name} className="flex items-center gap-2 text-[12.5px]">
                        {c.passed ? <CheckCircle2 className="size-3.5 shrink-0 text-ok" /> : <XCircle className="size-3.5 shrink-0 text-critical" />}
                        <span className={c.passed ? "text-ink-2" : "text-critical"}>{c.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {running && r.run && (
                  <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted"><CircleDashed className="size-3.5 animate-spin" />
                    Turn {r.run.turns} · {r.run.steps.filter((x) => x.kind === "tool_call").length} tool calls so far</div>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  <div className="text-[11.5px] text-muted tnum">
                    {r?.grade && `${r.grade.turns} turns · ${r.grade.tokens?.toLocaleString()} tok · ${(r.grade.model_latency_ms / 1000).toFixed(1)}s model · ${r.model.replace("nvidia/", "")}`}
                  </div>
                  <div className="flex gap-2">
                    {r && <Button size="sm" variant="ghost" onClick={() => setSelected(r.id)}>Trace</Button>}
                    <Button size="sm" variant="secondary" onClick={() => run(s.id)} disabled={running || batch || !health?.agent.enabled}><Play />Run</Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {sel && sel.run && (
        <div className="mt-6 rounded-[24px] bg-night p-5 text-white md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-white/45">Agent trace · {sel.id} · {sel.run.id}</div>
              <div className="mt-1 text-[18px] font-semibold">{sel.scenario.title}</div>
              <div className="text-[12px] text-white/45">{(sel.run.served_model || sel.run.model)} · {sel.run.status.toLowerCase().replace("_", " ")}</div>
            </div>
            <Button variant="night" size="sm" asChild><Link to={`/war-room/${sel.incident_id}`}>Open in war room <ArrowUpRight /></Link></Button>
          </div>
          <AgentTrace run={sel.run} maxHeight={620} />
        </div>
      )}

      {history.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="px-5 pt-5 text-[15px] font-semibold">Run history</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="border-y border-line bg-subtle/50 text-left text-[11.5px] text-muted">
                <th className="px-5 py-2 font-medium">Scenario</th><th className="font-medium">Model</th><th className="font-medium">Verdict</th>
                <th className="font-medium">Checks</th><th className="font-medium">Turns</th><th className="px-5 text-right font-medium">When</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} onClick={() => setSelected(h.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-subtle/60">
                    <td className="px-5 py-2.5 font-medium">{h.scenario.title}</td>
                    <td className="text-muted">{h.model?.replace("nvidia/", "")}</td>
                    <td>{h.grade ? <Verdict v={h.grade.verdict} /> : <Badge tone="accent">Running</Badge>}</td>
                    <td className="tnum">{h.grade ? `${h.grade.passed}/${h.grade.total}` : "—"}</td>
                    <td className="tnum">{h.grade?.turns ?? "—"}</td>
                    <td className="px-5 text-right text-muted">{timeAgo(h.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Verdict({ v }: { v: "PASS" | "PARTIAL" | "FAIL" }) {
  return <Badge tone={v === "PASS" ? "ok" : v === "PARTIAL" ? "high" : "critical"}>{v === "PASS" ? <CheckCircle2 /> : <XCircle />}{v}</Badge>;
}
