import { AnimatePresence, motion } from "motion/react";
import { Antenna, ArrowRight, MessageSquareWarning, Phone, Plus, Radio, ShieldAlert, Signal, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ErrorState, LiveDot, Metric, PageHeader, RiskRing, SeverityBadge, SimulatedTag, Skeleton } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/demo";
import type { TelemetryEvent, TelemetrySummary } from "@/lib/types";
import { cn, clockTime } from "@/lib/utils";

const CHANNEL_ICON = { sim: Smartphone, voice: Phone, sms: MessageSquareWarning, network: Antenna } as const;
type Filter = "all" | "flagged" | "sim" | "voice" | "network";

function riskColor(score: number) {
  return score >= 85 ? "var(--color-critical)" : score >= 65 ? "var(--color-high)" : score >= 45 ? "var(--color-medium)" : "var(--color-ok)";
}

export default function ProactiveDefense() {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const fresh = useRef(new Set<string>());
  const navigate = useNavigate();
  const { mark } = useDemo();

  const load = () => api.telemetry(80).then((d) => { setEvents(d.events); setSummary(d.summary); setError(null); })
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      try {
        const d = await api.simulateTelemetry(1);
        d.events.forEach((e) => fresh.current.add(e.id));
        setEvents((prev) => [...d.events, ...prev].slice(0, 120));
        setSummary(d.summary);
      } catch (e) { setError((e as Error).message); }
    }, 2600);
    return () => clearInterval(id);
  }, [live]);

  const inject = async () => {
    const d = await api.simulateTelemetry(5);
    d.events.forEach((e) => fresh.current.add(e.id));
    setEvents((prev) => [...d.events.reverse(), ...prev].slice(0, 120));
    setSummary(d.summary);
    toast.success("5 synthetic carrier events processed by the risk engine");
  };

  const visible = useMemo(() => events.filter((e) =>
    filter === "all" ? true : filter === "flagged" ? e.risk_score >= 60 : e.channel === filter || (filter === "voice" && e.channel === "sms")), [events, filter]);
  const selected = events.find((e) => e.id === selectedId) ?? visible.find((e) => e.risk_score >= 60) ?? visible[0];

  const openIncident = async (ev: TelemetryEvent) => {
    setOpening(true);
    try {
      const st = await api.triggerIncident({
        source: "telemetry", title: `${ev.label} · ${ev.cell_id}`, threat_type: ev.type === "NETWORK_DOWNGRADE" ? "Network downgrade / IMSI catcher" :
          ev.channel === "sim" ? "SIM swap — account takeover precursor" : `${ev.label}`,
        sanitized_transcript: [{ speaker: "carrier", text: `${ev.label} for ${ev.subscriber_token} on ${ev.network}: ${ev.details}` }],
        entities_removed: { PHONE: 1 }, interventions: [], evidence_refs: [ev.id], edge_tokenized: true,
      });
      mark({ incidentId: st.incident.id });
      toast.success(`Incident ${st.incident.id} opened`);
      navigate(`/war-room/${st.incident.id}`);
    } catch (e) { toast.error((e as Error).message); } finally { setOpening(false); }
  };

  if (error && !summary) return <ErrorState error={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        eyebrow={<><span className="text-ink">Before</span> · Proactive Defense</>}
        title="Carrier telemetry monitoring" highlight="monitoring"
        description="The gateway scores carrier signaling and network events as they arrive. It flags SIM swap and port-out requests, spoofed VoIP calls and forced downgrades to unencrypted 2G, which often come before an account takeover."
        actions={<>
          <label className="flex h-9 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-medium">
            {live ? <LiveDot /> : <span className="size-2 rounded-full bg-faint" />} Live feed
            <Switch checked={live} onCheckedChange={setLive} aria-label="Toggle live feed" />
          </label>
          <Button variant="secondary" onClick={inject}><Plus />Inject 5 events</Button>
        </>}
      />

      {!summary ? <Skeleton className="h-[480px] rounded-2xl" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Events analyzed" value={summary.total} icon={<Radio />} hint={`Average risk ${summary.avg_risk}`} />
            <Metric label="SIM-swap indicators" value={summary.sim_swap_indicators} icon={<Smartphone />} tone="critical" hint="Swap, port-out & IMEI changes ≥ 60" />
            <Metric label="Suspicious VoIP" value={summary.voip_suspicious} icon={<Phone />} hint="Spoofed origination & robocall bursts" />
            <Metric label="2G downgrades" value={summary.downgrades} icon={<Signal />} hint="Unauthenticated null-cipher fallbacks" />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <Card className="overflow-hidden">
              <CardHeader eyebrow="Carrier event stream" title="Incoming telemetry" description="Subscriber identities are tokenized at ingestion."
                action={<SimulatedTag />} />
              <div className="mt-4 flex items-center justify-between gap-3 border-y border-line px-5 py-2.5">
                <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="flagged">Flagged</TabsTrigger>
                    <TabsTrigger value="sim">SIM</TabsTrigger>
                    <TabsTrigger value="voice">Voice & SMS</TabsTrigger>
                    <TabsTrigger value="network">Network</TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="hidden text-[12px] text-muted sm:block tnum">{visible.length} events</span>
              </div>
              <div className="scroll-thin max-h-[560px] overflow-y-auto">
                <AnimatePresence initial={false}>
                  {visible.map((e) => {
                    const Icon = CHANNEL_ICON[e.channel];
                    const isSel = selected?.id === e.id;
                    return (
                      <motion.button key={e.id} layout="position" onClick={() => setSelectedId(e.id)}
                        initial={fresh.current.has(e.id) ? { opacity: 0, backgroundColor: "rgba(74,222,128,0.1)" } : false}
                        animate={{ opacity: 1, backgroundColor: isSel ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0)" }}
                        transition={{ duration: 0.5 }}
                        className="flex w-full items-center gap-4 border-b border-line px-5 py-3 text-left last:border-0 hover:bg-subtle/60">
                        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                          e.risk_score >= 60 ? "bg-critical-soft text-critical" : "bg-subtle text-muted")}><Icon /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-medium">{e.label}</span>
                            {e.risk_score >= 60 && <SeverityBadge severity={e.severity} />}
                          </div>
                          <div className="truncate text-[12px] text-muted">{e.details}</div>
                        </div>
                        <div className="hidden w-32 shrink-0 text-right text-[12px] text-muted md:block">
                          <div>{e.cell_id}</div><div className="text-faint">{e.network}</div>
                        </div>
                        <div className="w-[72px] shrink-0">
                          <div className="mb-1 text-right text-[13px] font-semibold tnum">{e.risk_score}</div>
                          <div className="h-1 rounded-full bg-subtle"><div className="h-full rounded-full" style={{ width: `${e.risk_score}%`, background: riskColor(e.risk_score) }} /></div>
                        </div>
                        <span className="hidden w-16 shrink-0 text-right text-[11.5px] text-faint tnum lg:block">{clockTime(e.created_at)}</span>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>
            </Card>

            <div className="space-y-5">
              {selected && (
                <Card className="lg:sticky lg:top-8">
                  <CardHeader eyebrow={`${selected.id} · ${selected.channel}`} title={selected.label} />
                  <div className="flex items-center gap-5 px-5 pt-5">
                    <RiskRing value={selected.risk_score} size={96} stroke={8} />
                    <div className="space-y-1.5 text-[12.5px]">
                      <SeverityBadge severity={selected.severity} />
                      <div className="text-muted">Cell <span className="text-ink">{selected.cell_id}</span></div>
                      <div className="text-muted">Network <span className="text-ink">{selected.network}</span></div>
                      <div className="text-muted">Subscriber <span className="token-chip text-[11.5px]">{selected.subscriber_token}</span></div>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <div className="eyebrow mb-1.5">Signal</div>
                      <p className="text-[13px] leading-relaxed text-ink-2">{selected.details}</p>
                    </div>
                    <div className="rounded-xl bg-subtle p-3.5">
                      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold"><ShieldAlert className="size-3.5" />Protection recommendation</div>
                      <p className="text-[13px] leading-relaxed text-ink-2">{selected.recommendation}</p>
                    </div>
                    {selected.risk_score >= 60 ? (
                      <Button className="w-full" onClick={() => openIncident(selected)} loading={opening}>Open incident in war room <ArrowRight /></Button>
                    ) : <p className="text-center text-[12px] text-muted">Below incident threshold (60). Monitoring only.</p>}
                  </div>
                </Card>
              )}
              <Card className="p-5">
                <div className="eyebrow mb-3">Recommendations in effect</div>
                <ul className="space-y-2.5 text-[13px] text-ink-2">
                  {["Hold SIM swaps 24h after a port-out PIN failure", "Whisper-screen attestation-C calls to high-risk subscribers",
                    "Disable 2G fallback where null-cipher cells are observed", "Rewrite SMS links through the safe-browsing proxy"].map((r) => (
                    <li key={r} className="flex gap-2.5"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />{r}</li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
