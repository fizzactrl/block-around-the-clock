import { motion } from "motion/react";
import {
  ArrowRight, ArrowUpRight, CheckCircle2, Clock3, Fingerprint, Link2, PhoneCall, Radar, ShieldCheck, Siren, Target, Zap,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ErrorState, LiveDot, Metric, PageHeader, RiskRing, SeverityBadge, Skeleton, StatusBadge,
} from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import { usePoll } from "@/hooks/usePoll";
import { api } from "@/lib/api";
import type { AuditEntry, Dashboard } from "@/lib/types";
import { cn, duration, timeAgo } from "@/lib/utils";

/** Ordinal single-hue ramp, validated for the dark surface: low (dim) → critical (bright). */
const SEV_RAMP = { low: "#7d3322", medium: "#b84a2c", high: "#e86a3e", critical: "#ffa077" } as const;
const SEV_ORDER = ["low", "medium", "high", "critical"] as const;

const POSTURE = {
  protected: { color: "var(--color-ok)", copy: "All monitored lines are covered. There are no open incidents." },
  elevated: { color: "var(--color-high)", copy: "An incident is open. Review it in the war room to confirm that containment finished." },
  under_attack: { color: "var(--color-critical)", copy: "A critical incident is open and containment steps are running." },
};

export default function CommandCenter() {
  const { data, error, refresh } = usePoll(api.dashboard, 5000);
  const navigate = useNavigate();

  if (error && !data) return <ErrorState error={error} onRetry={refresh} />;

  return (
    <>
      <PageHeader
        eyebrow={<><LiveDot /> Command Center</>}
        title="Security overview" highlight="overview"
        description="Protection status for all monitored lines, threats detected in the last 24 hours, and open incidents."
        actions={<>
          <Button variant="secondary" asChild><Link to="/proactive"><Radar />Telemetry</Link></Button>
          <Button onClick={() => navigate("/live-call")}><PhoneCall />Simulate suspicious call</Button>
        </>}
      />
      {!data ? <LoadingGrid /> : <Content d={data} />}
    </>
  );
}

function Content({ d }: { d: Dashboard }) {
  const posture = POSTURE[d.protection.posture];
  const active = d.active_incidents[0];
  return (
    <div className="space-y-5">
      {/* ── Posture hero ─────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-[380px] rounded-full opacity-[0.07] blur-3xl" style={{ background: posture.color }} />
        <div className="relative grid gap-8 p-6 md:grid-cols-[1fr_auto] md:p-8">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <div className="eyebrow mb-3">Protection status</div>
              <div className="flex items-center gap-3">
                <LiveDot color={posture.color} className="size-2.5" />
                <motion.h2 key={d.protection.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className="display text-[44px] leading-none md:text-[56px]">{d.protection.label}</motion.h2>
              </div>
              <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">{posture.copy}</p>
            </div>
            {active ? (
              <Link to={`/war-room/${active.id}`} className="group flex max-w-xl items-center gap-4 rounded-xl border border-critical/20 bg-critical-soft/60 p-3.5 transition hover:border-critical/40">
                <div className="flex size-9 items-center justify-center rounded-lg bg-critical text-white"><Siren className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{active.title}</div>
                  <div className="text-[12px] text-muted">{active.id} · risk {active.risk_score} · {timeAgo(active.created_at)}</div>
                </div>
                <StatusBadge status={active.status} />
                <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5" />
              </Link>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[["Before", "Proactive telemetry", "/proactive", Radar], ["During", "Live call defense", "/live-call", PhoneCall],
                  ["After", "Incident war room", "/war-room", Siren]].map(([phase, label, to, Icon]) => {
                  const I = Icon as typeof Radar;
                  return (
                    <Link key={phase as string} to={to as string} className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 transition hover:border-line-strong hover:shadow-[var(--shadow-card)]">
                      <I className="size-4 text-muted" />
                      <span className="text-[12px] font-medium text-faint">{phase as string}</span>
                      <span className="text-[13px] font-medium">{label as string}</span>
                      <ArrowUpRight className="size-3.5 text-faint transition group-hover:text-ink" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-6 md:flex-col md:items-end md:justify-between">
            <RiskRing value={d.protection.score} size={148} stroke={10} label="Coverage" color={posture.color} />
            <div className="grid grid-cols-1 gap-1.5 text-right text-[12px] text-muted">
              <span className="flex items-center justify-end gap-1.5"><Fingerprint className="size-3.5" />{d.metrics.events_analyzed_24h} carrier events / 24h</span>
              <Tip content={`Head ${d.audit_chain.head.slice(0, 16)}… · hash chaining gives tamper evidence, not immutable storage.`}>
                <span className="flex cursor-help items-center justify-end gap-1.5">
                  <Link2 className="size-3.5" />Audit chain {d.audit_chain.valid ? "intact" : "broken"} · {d.audit_chain.entries}
                </span>
              </Tip>
            </div>
          </div>
        </div>
      </Card>

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Active incidents" value={d.metrics.active_incidents} icon={<Siren />} tone={d.metrics.active_incidents ? "critical" : undefined}
          hint={d.metrics.active_incidents ? "Requires war-room attention" : "Nothing open right now"} />
        <Metric label="Threats detected · 24h" value={d.metrics.threats_detected_24h} icon={<Target />}
          hint={`of ${d.metrics.events_analyzed_24h} events scored ≥ 60`} />
        <Metric label="Containment progress" value={d.metrics.containment_progress} suffix="%" icon={<ShieldCheck />} tone="ok"
          hint={`${d.metrics.actions_succeeded} of ${d.metrics.actions_total} actions succeeded`} />
        <Metric label="Mean time to contain" value={duration(d.metrics.mean_time_to_contain_s)} icon={<Clock3 />}
          hint={`${d.metrics.incidents_contained} incidents contained`} />
      </div>

      {/* ── Threat activity ─────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader eyebrow="Before" title="Threat activity, last 24 hours" description="Carrier events scored by the risk engine, stacked by severity."
            action={<div className="flex flex-wrap items-center justify-end gap-3 text-[12px] text-muted">
              {SEV_ORDER.map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className="size-2 rounded-[3px]" style={{ background: SEV_RAMP[s] }} />{s[0].toUpperCase() + s.slice(1)}</span>
              ))}
            </div>} />
          <div className="h-[260px] px-3 pb-4 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.threat_timeline} barCategoryGap={3} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="0" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={3} tick={{ fontSize: 11, fill: "var(--color-faint)" }} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={44} tick={{ fontSize: 11, fill: "var(--color-faint)" }} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<TimelineTooltip />} />
                {SEV_ORDER.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="a" fill={SEV_RAMP[s]} stroke="var(--color-surface)" strokeWidth={1}
                    radius={i === SEV_ORDER.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow="Threat mix" title="Threat types" description="Non-routine events among the last 400 scored." />
          <div className="space-y-3.5 px-5 pb-5 pt-5">
            {d.threat_mix.map((t) => {
              const max = d.threat_mix[0]?.count || 1;
              return (
                <Tip key={t.label} content={`${t.count} events`} side="left">
                  <div className="cursor-default">
                    <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                      <span className="text-ink-2">{t.label}</span>
                      <span className="font-medium tnum">{t.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-subtle">
                      <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${(t.count / max) * 100}%` }}
                        transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }} />
                    </div>
                  </div>
                </Tip>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── Incidents + activity ────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader eyebrow="After" title="Incidents" description="Each incident with its containment status. Every action is written to the audit log."
            action={<Button variant="ghost" size="sm" asChild><Link to="/war-room">War room <ArrowRight /></Link></Button>} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-y border-line bg-subtle/50 text-left text-[11.5px] text-muted">
                  <th className="px-5 py-2 font-medium">Incident</th><th className="py-2 font-medium">Severity</th>
                  <th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Actions</th><th className="px-5 py-2 text-right font-medium">Opened</th>
                </tr>
              </thead>
              <tbody>
                {d.incidents.map((i) => (
                  <tr key={i.id} className="group border-b border-line last:border-0 hover:bg-subtle/60">
                    <td className="px-5 py-3">
                      <Link to={`/war-room/${i.id}`} className="block">
                        <div className="font-medium group-hover:text-accent">{i.title}</div>
                        <div className="text-[12px] text-muted">{i.id} · {i.source}</div>
                      </Link>
                    </td>
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td><StatusBadge status={i.status} /></td>
                    <td className="text-muted tnum">{i.actions_succeeded}/{i.actions_total}</td>
                    <td className="px-5 text-right text-muted">{timeAgo(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader eyebrow="Audit trail" title="Recent activity"
            action={<span className={cn("flex items-center gap-1 text-[11.5px] font-medium", d.audit_chain.valid ? "text-ok" : "text-critical")}>
              <CheckCircle2 className="size-3.5" />{d.audit_chain.valid ? "Chain verified" : "Chain broken"}</span>} />
          <ActivityFeed items={d.recent_activity} />
        </Card>
      </div>
    </div>
  );
}

const EVENT_ICON: Record<string, typeof Zap> = { incident: Siren, containment: ShieldCheck, telemetry: Radar, ai: Zap, privacy: Fingerprint, call: PhoneCall, policy: Target };

export function ActivityFeed({ items, className }: { items: AuditEntry[]; className?: string }) {
  return (
    <ol className={cn("scroll-thin max-h-[360px] flex-1 overflow-y-auto px-5 pb-4 pt-3", className)}>
      {items.map((a, idx) => {
        const Icon = EVENT_ICON[a.event_type.split(".")[0]] ?? Zap;
        const bad = a.event_type.includes("failed") || a.event_type.includes("rejected") || a.event_type.includes("attention");
        return (
          <motion.li key={a.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }}
            className="relative flex gap-3 pb-4 last:pb-0">
            {idx < items.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-22px)] w-px bg-line" />}
            <span className={cn("mt-0.5 flex size-[27px] shrink-0 items-center justify-center rounded-full border border-line bg-surface [&_svg]:size-3.5",
              bad ? "text-critical" : "text-muted")}><Icon /></span>
            <div className="min-w-0 pt-0.5">
              <div className="text-[12.5px] leading-snug text-ink">{a.summary}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                <span>{timeAgo(a.ts)}</span>·<span className="truncate">{a.actor}</span>·
                <Tip content={`SHA-256 ${a.hash}`}><span className="cursor-help font-mono text-[10.5px]">#{a.hash.slice(0, 6)}</span></Tip>
              </div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

function TimelineTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="min-w-[150px] rounded-xl border border-line bg-surface p-3 text-[12px] shadow-[var(--shadow-lift)]">
      <div className="mb-2 flex justify-between font-medium"><span>{label}</span><span className="tnum">{total} events</span></div>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5 text-ink-2">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-[3px]" style={{ background: SEV_RAMP[p.dataKey as keyof typeof SEV_RAMP] }} />{p.dataKey}</span>
          <span className="tnum">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[260px] rounded-2xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)}</div>
      <Skeleton className="h-[320px] rounded-2xl" />
    </div>
  );
}
