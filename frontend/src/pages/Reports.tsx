import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileText, FlaskConical, HelpCircle, Link2, Printer, Scale, XCircle } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorState, PageHeader, SeverityBadge, Skeleton, StatusBadge } from "@/components/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/demo";
import type { IncidentSummary, LegalReport } from "@/lib/types";
import { clockTime, cn, timeAgo } from "@/lib/utils";

export default function Reports() {
  const { id } = useParams();
  const { incidentId } = useDemo();
  const navigate = useNavigate();
  useEffect(() => { if (!id && incidentId) navigate(`/reports/${incidentId}`, { replace: true }); }, [id, incidentId, navigate]);
  return id ? <ReportView id={id} /> : <ReportPicker />;
}

function ReportPicker() {
  const [items, setItems] = useState<IncidentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.incidents().then(setItems).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorState error={error} />;
  return (
    <>
      <PageHeader eyebrow={<><Scale className="size-3" />Legal & Forensics</>} title="Incident reports" highlight="reports"
        description="Each report includes the incident timeline, evidence hashes, containment results and a draft FTC identity theft statement. Reports are drafts and must be reviewed by a person before anything is submitted." />
      <Card className="overflow-hidden">
        {!items ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> : items.map((i) => (
          <Link key={i.id} to={`/reports/${i.id}`} className="group flex items-center gap-4 border-b border-line px-5 py-4 last:border-0 hover:bg-subtle/60">
            <span className="flex size-9 items-center justify-center rounded-lg bg-subtle text-muted"><FileText className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium group-hover:text-accent">{i.title}</div>
              <div className="text-[12px] text-muted">{i.id} · {timeAgo(i.created_at)}</div>
            </div>
            <SeverityBadge severity={i.severity} /><span className="hidden sm:block"><StatusBadge status={i.status} /></span>
            <ArrowRight className="size-4 text-faint group-hover:text-ink" />
          </Link>
        ))}
      </Card>
    </>
  );
}

const REVIEW_ITEMS = [
  "I verified each simulated containment action directly with the provider",
  "I confirmed with the consumer which details were actually disclosed",
  "Counsel reviewed the regulatory scope summary",
];

function ReportView({ id }: { id: string }) {
  const [r, setR] = useState<LegalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<boolean[]>(REVIEW_ITEMS.map(() => false));

  const load = () => api.report(id).then((d) => { setR(d); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!r) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-[600px] rounded-2xl" /></div>;
  const ident = r.identification;
  const reviewed = checks.every(Boolean);

  return (
    <>
      <PageHeader
        eyebrow={<><Scale className="size-3" />Legal & Forensics · {r.report_id}</>}
        title="Incident report"
        description={<>Generated {clockTime(r.generated_at)} for <Link to={`/war-room/${id}`} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">{id}</Link>. Personal data appears only as tokens.</>}
        actions={<>
          <Button variant="secondary" onClick={() => window.print()}><Printer />Print</Button>
          <Button asChild><a href={api.reportPdfUrl(id)} download><Download />Export PDF</a></Button>
        </>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden">
          <div className="flex items-start gap-3 border-b border-high/25 bg-high-soft px-6 py-4 text-[13px] text-[#ffc9a3] md:px-10">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div><b className="font-semibold">{r.status}.</b> {r.disclaimer}</div>
          </div>

          <div className="space-y-10 px-6 py-8 md:px-10 md:py-10">
            <header>
              <div className="eyebrow mb-2">{ident.incident_id as string}</div>
              <h2 className="display text-[30px] leading-tight">{ident.title as string}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <SeverityBadge severity={ident.severity as "critical"} />
                <Badge tone="outline">Risk {ident.risk_score}</Badge>
                <Badge tone="outline">{ident.threat_type as string}</Badge>
                <Badge tone="outline"><FlaskConical />{ident.data_classification as string}</Badge>
              </div>
            </header>

            <Section n={1} title="Incident identification">
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {Object.entries(ident).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 text-[13px]">
                    <dt className="text-muted">{k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</dt>
                    <dd className="text-right font-medium">{k.endsWith("_at") && v ? new Date(v as string).toLocaleString() : (v ?? "—")}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section n={2} title="Summary">
              <p className="text-[14.5px] leading-relaxed text-ink-2">{r.summary}</p>
              <p className="mt-2 text-[12px] text-muted">
                {r.agent_trace ? <>Contained by the NVIDIA Nemotron agent · {r.agent_trace.served_model || r.agent_trace.model} · run {r.agent_trace.run_id}</>
                  : <>AI commander: {r.ai_commander.engine === "nemotron" ? "NVIDIA Nemotron" : "deterministic playbook (seed data)"} · {r.ai_commander.model}</>}
              </p>
            </Section>

            {r.agent_trace && (
              <Section n={2.5} title="Agent action trace" aside={`${r.agent_trace.turns} model turns · ${r.agent_trace.tokens.toLocaleString()} tokens · ${r.agent_trace.status.toLowerCase().replace("_", " ")}`}>
                {r.agent_trace.environment.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">{r.agent_trace.environment.map((e) => <Badge key={e} tone="accent"><FlaskConical />Simulated: {e}</Badge>)}</div>
                )}
                <ol className="divide-y divide-line rounded-xl border border-line">
                  {r.agent_trace.steps.map((t) => (
                    <li key={t.n} className={cn("grid grid-cols-[28px_1fr] gap-3 px-4 py-2.5 text-[13px]",
                      t.kind === "failure" && "bg-critical-soft/50", t.kind === "replan" && "bg-high-soft/50", t.kind === "decision" && "text-muted")}>
                      <span className="text-faint tnum">{t.n}</span>
                      <div className="min-w-0">
                        <div className={cn("break-words font-medium", t.kind === "decision" && "font-normal text-[12px]",
                          t.kind === "failure" && "text-critical", t.kind === "replan" && "text-[#ffb37a]")}>{t.label}</div>
                        {t.detail && <div className="mt-0.5 break-words text-[12.5px] text-muted">{t.detail}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <Section n={3} title="Facts — confirmed vs simulated">
              <div className="grid gap-4 md:grid-cols-3">
                <FactCol icon={<CheckCircle2 className="text-ok" />} title="System-observed" items={r.facts.confirmed} />
                <FactCol icon={<FlaskConical className="text-accent" />} title="Simulated" items={r.facts.simulated} />
                <FactCol icon={<HelpCircle className="text-high" />} title="Unverified / missing" items={r.facts.unverified} />
              </div>
            </Section>

            <Section n={4} title="Containment actions" aside={`${r.containment.succeeded}/${r.containment.total} succeeded · simulated adapters`}>
              <Table head={["Action", "Status", "Attempts", "Reference"]} rows={r.containment.actions.map((a) => [
                a.label,
                <span key="s" className={cn("inline-flex items-center gap-1.5 font-medium", a.status === "SUCCEEDED" ? "text-ok" : a.status === "FAILED" ? "text-critical" : "text-muted")}>
                  {a.status === "SUCCEEDED" ? <CheckCircle2 className="size-3.5" /> : a.status === "FAILED" ? <XCircle className="size-3.5" /> : null}{a.status.toLowerCase()}</span>,
                a.attempts, <code key="c" className="text-[12px] text-muted">{a.reference ?? "—"}</code>])} />
            </Section>

            <Section n={5} title="Timeline of events">
              <ol className="space-y-0">
                {r.timeline.map((t, i) => (
                  <li key={i} className="grid grid-cols-[72px_1fr_auto] gap-4 border-b border-line py-2.5 text-[13px] last:border-0">
                    <span className="text-muted tnum">{clockTime(t.ts)}</span>
                    <div><div>{t.summary}</div><div className="text-[11.5px] text-faint">{t.event} · {t.actor}</div></div>
                    <Badge className="self-start" tone={t.classification === "simulated" ? "accent" : "neutral"}>{t.classification}</Badge>
                  </li>
                ))}
              </ol>
            </Section>

            <Section n={6} title="Evidence references" aside={<span className="flex items-center gap-1.5"><Link2 className="size-3.5" />Audit chain {r.audit_chain.valid ? "intact" : "BROKEN"} · {r.audit_chain.entries} entries</span>}>
              <Table head={["Ref", "Kind", "Pointer", "SHA-256"]} rows={r.evidence.map((e) => [e.ref, e.kind, <code key="p" className="text-[12px]">{e.pointer}</code>,
                <code key="h" className="text-[11.5px] text-muted">{e.sha256.slice(0, 20)}…</code>])} />
              <p className="mt-2 text-[12px] text-muted">Hash chaining provides tamper evidence for this demo. It is not cryptographically immutable storage.</p>
            </Section>

            <Section n={7} title="Draft FTC identity theft documentation" aside="Not submitted">
              <p className="mb-3 text-[13px] text-muted">{r.ftc_draft.note}</p>
              <div className="divide-y divide-line rounded-xl border border-line">
                {r.ftc_draft.fields.map((f) => (
                  <div key={f.label} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[220px_1fr_auto] sm:gap-4">
                    <span className="text-muted">{f.label}</span>
                    <span className={cn(f.value.startsWith("[") && "italic text-faint")}>{f.value}</span>
                    <Badge className="self-start" tone={f.source === "system" ? "neutral" : "medium"}>{f.source}</Badge>
                  </div>
                ))}
              </div>
            </Section>

            <Section n={8} title="Regulatory incident scope" aside="For counsel">
              <p className="mb-3 text-[13px] text-muted">{r.regulatory_scope.note}</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {r.regulatory_scope.data_categories_involved.map((c) => <Badge key={c.category} tone="outline">{c.category} · {c.occurrences} tokenized</Badge>)}
              </div>
              <ul className="space-y-2 text-[13.5px] text-ink-2">
                {r.regulatory_scope.considerations.map((c) => <li key={c} className="flex gap-2.5"><span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />{c}</li>)}
              </ul>
            </Section>
          </div>
        </motion.article>

        <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          <Card className="p-5">
            <div className="eyebrow mb-3">Human review gate</div>
            <div className="space-y-2.5">
              {REVIEW_ITEMS.map((t, i) => (
                <label key={t} className="flex cursor-pointer gap-2.5 text-[13px] leading-snug">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[#4ade80]" checked={checks[i]} onChange={() => setChecks((c) => c.map((x, j) => (j === i ? !x : x)))} />
                  <span className={checks[i] ? "text-ink" : "text-ink-2"}>{t}</span>
                </label>
              ))}
            </div>
            <div className={cn("mt-4 rounded-xl p-3 text-[12.5px]", reviewed ? "bg-ok-soft text-[#86efac]" : "bg-subtle text-muted")}>
              {reviewed ? "Review checklist complete. Submission remains a manual step outside this system." : "Complete the checklist before using this draft. Nothing is filed automatically."}
            </div>
          </Card>
          <Card className="p-5">
            <div className="eyebrow mb-3">At a glance</div>
            <div className="space-y-2 text-[13px]">
              <Row k="Actions succeeded" v={`${r.containment.succeeded} / ${r.containment.total}`} />
              <Row k="Timeline events" v={r.timeline.length} />
              <Row k="Evidence items" v={r.evidence.length} />
              <Row k="Audit chain" v={r.audit_chain.valid ? "Intact" : "Broken"} />
              <Row k="Raw PII in report" v="None" />
            </div>
          </Card>
          <Button variant="secondary" className="w-full" asChild><a href={api.reportPdfUrl(id)} download><Download />Download PDF draft</a></Button>
        </aside>
      </div>
    </>
  );
}

function Section({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[17px] font-semibold tracking-[-0.015em]"><span className="mr-2 text-faint tnum">{n}.</span>{title}</h3>
        {aside && <span className="text-[12px] text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function FactCol({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold [&_svg]:size-4">{icon}{title}</div>
      <ul className="space-y-1.5 text-[12.5px] leading-snug text-ink-2">
        {(items.length ? items : ["None"]).map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[520px] text-[13px]">
        <thead><tr className="bg-subtle/60 text-left text-[11.5px] text-muted">{head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-4 py-2.5">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className="font-medium">{v}</span></div>;
}
