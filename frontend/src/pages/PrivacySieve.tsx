import { motion } from "motion/react";
import { ArrowRight, CheckCircle2, CloudOff, Cpu, Eye, Lock, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AnimatedNumber, PageHeader, SimulatedTag } from "@/components/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/demo";
import { detect, PII_LABELS, privacyPolicy, tokenizeLocal, type TokenizeOutput } from "@/lib/tokenizer";
import type { TokenizeResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS: Record<string, { label: string; text: string }> = {
  call: {
    label: "Call transcript",
    text: `INCIDENT PAYLOAD — synthetic
Subscriber: Maya Chen (415-555-0198)
Caller ID: +1 (415) 555-0142, attestation C, VoIP origin

Caller: Hi, is this Maya Chen? This is Daniel calling from the corporate IT service desk.
Caller: I just sent a verification code to 415-555-0198. Can you read it back? It should say code 482913.
Caller: I'll also need to confirm the Social Security number on file, 512-44-8890.
Caller: Then we'll secure your Wells Fargo account ending in 4421 and install AnyDesk.`,
  },
  ticket: {
    label: "Helpdesk ticket",
    text: `{
  "ticket": "HD-20931",
  "reporter": "Priya Patel",
  "email": "priya.patel@example.com",
  "callback": "(646) 555-0177",
  "notes": "Caller claimed to be carrier support, requested transfer PIN 5521 for eSIM port-out.",
  "linked_accounts": ["Chase acct 99887766", "Capital One card 4111 1111 1111 1111"]
}`,
  },
  dispute: {
    label: "Bank dispute email",
    text: `From: marcus.okafor@example.com
To: disputes@bank.example

Hello, my name is Marcus Okafor. Someone from "Chase Fraud" called me from 212-555-0101 and convinced me
to move $9,000 to a safe account via Zelle. They asked for my SSN 623-11-4507 and passcode 739204.
My account number is 000123456789. Please call me at +1 646 555 0123.`,
  },
};

export default function PrivacySieve() {
  const [preset, setPreset] = useState("call");
  const [raw, setRaw] = useState(PRESETS.call.text);
  const [local, setLocal] = useState<TokenizeOutput | null>(null);
  const [server, setServer] = useState<TokenizeResult | null>(null);
  const [bypass, setBypass] = useState<TokenizeResult | null>(null);
  const [validating, setValidating] = useState<"edge" | "bypass" | null>(null);
  const { incident } = useDemo();

  useEffect(() => {
    let alive = true;
    tokenizeLocal(raw).then((r) => alive && setLocal(r));
    setServer(null);
    setBypass(null);
    return () => { alive = false; };
  }, [raw]);

  const detections = useMemo(() => detect(raw), [raw]);

  const validate = async () => {
    if (!local) return;
    setValidating("edge");
    try {
      const r = await api.tokenize(local.text, true);
      setServer(r);
      r.residual_pii === 0 ? toast.success("Server validation passed — zero residual PII") : toast.warning(`Server tokenized ${r.residual_pii} residual value(s)`);
    } catch (e) { toast.error((e as Error).message); } finally { setValidating(null); }
  };

  const simulateBypass = async () => {
    setValidating("bypass");
    try {
      setBypass(await api.tokenize(raw, true));
    } catch (e) { toast.error((e as Error).message); } finally { setValidating(null); }
  };

  const aiPayload = local ? JSON.stringify({
    model_input: "sanitized_incident_context",
    policy_version: privacyPolicy.version,
    text: local.text.length > 420 ? local.text.slice(0, 420) + "…" : local.text,
    pii_categories_removed: Object.keys(local.counts),
  }, null, 2) : "";

  return (
    <>
      <PageHeader
        eyebrow={<><Lock className="size-3" /> Privacy Sieve</>}
        title="Personal data tokenization" highlight="tokenization"
        description="Personal data is replaced with tokens in the browser before anything is sent. The server then scans the payload again with the same rules. Tokens are one-way: no lookup table is stored, so they cannot be converted back to the original values."
        actions={<SimulatedTag label="Synthetic data" tip="All names, numbers and SSNs on this page are fabricated (555 numbers, invalid SSN ranges)." />}
      />

      {incident && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
          <ShieldCheck className="size-4 text-ok" />
          <span>Active incident <b className="font-semibold">{incident.incident.id}</b> was stored with <b className="font-semibold">{incident.incident.privacy.total_removed}</b> values tokenized at the edge and <b className="font-semibold">{Object.values(incident.incident.privacy.server_residual).reduce((a, b) => a + b, 0)}</b> residual found by the server.</span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={preset} onValueChange={(v) => { setPreset(v); setRaw(PRESETS[v].text); }}>
          <TabsList>{Object.entries(PRESETS).map(([k, p]) => <TabsTrigger key={k} value={k}>{p.label}</TabsTrigger>)}</TabsList>
        </Tabs>
        <span className="text-[12.5px] text-muted">Edit the raw payload — detection runs live, locally.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader eyebrow="Raw · stays on device" title="Synthetic incident payload"
            action={<Badge tone="critical"><Eye />{detections.length} sensitive</Badge>} />
          <div className="relative m-5 mt-4 flex-1 overflow-hidden rounded-xl border border-line bg-canvas">
            <HighlightLayer text={raw} spans={detections} />
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} aria-label="Raw payload"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              className="relative z-10 block h-full min-h-[340px] w-full resize-none overflow-hidden bg-transparent p-4 font-mono text-[12.5px] leading-[1.7] text-transparent caret-ink outline-none selection:bg-accent/20" />
          </div>
        </Card>

        <div className="flex items-center justify-center lg:flex-col">
          <motion.div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 shadow-[var(--shadow-card)] lg:flex-col lg:px-2 lg:py-4"
            animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
            <Cpu className="size-4 text-muted" />
            <span className="text-[11px] font-medium text-muted lg:[writing-mode:vertical-rl]">HMAC · in browser</span>
            <ArrowRight className="size-4 lg:rotate-0" />
          </motion.div>
        </div>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader eyebrow="Tokenized · safe to transmit" title="Sanitized payload"
            action={<Badge tone="ok"><ShieldCheck />{local?.total ?? 0} tokenized</Badge>} />
          <div className="m-5 mt-4 min-h-[340px] flex-1 whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas p-4 font-mono text-[12.5px] leading-[1.7] text-ink-2">
            {local ? <TokenView text={local.text} /> : "…"}
          </div>
        </Card>
      </div>

      {/* Removal summary */}
      <Card className="mt-4 p-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex items-center gap-4 md:w-[260px]">
            <div className="text-[44px] font-semibold leading-none tracking-[-0.04em]"><AnimatedNumber value={local?.total ?? 0} /></div>
            <div className="text-[13px] leading-snug text-muted">sensitive values removed<br />before cloud AI processing</div>
          </div>
          <div className="flex flex-1 flex-wrap gap-2">
            {privacyPolicy.detectors.map((d) => {
              const n = local?.counts[d.type] ?? 0;
              return (
                <div key={d.type} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] transition",
                  n ? "border-accent/25 bg-accent-soft text-ink" : "border-dashed border-line text-faint")}>
                  <span className="font-medium">{d.label}</span>
                  <span className={cn("rounded-md px-1.5 text-[11.5px] font-semibold tnum", n ? "bg-accent text-on-ink" : "bg-subtle")}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader eyebrow="Defense in depth" title="Server validation" description="The gateway re-scans the edge-tokenized payload with the same shared policy." />
          <div className="flex flex-1 flex-col justify-between gap-4 p-5">
            {server ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className={cn("flex items-center gap-3 rounded-xl p-3.5", server.residual_pii === 0 ? "bg-ok-soft" : "bg-high-soft")}>
                {server.residual_pii === 0 ? <CheckCircle2 className="size-5 text-ok" /> : <TriangleAlert className="size-5 text-high" />}
                <div className="text-[13px]">
                  <div className="font-semibold">{server.residual_pii === 0 ? "Clean — 0 residual values" : `${server.residual_pii} residual value(s) tokenized`}</div>
                  <div className="text-muted">Policy {privacyPolicy.version}</div>
                </div>
              </motion.div>
            ) : <p className="text-[13px] text-muted">Send the tokenized payload (never the raw one) to the Flask validator.</p>}
            <Button onClick={validate} loading={validating === "edge"} disabled={!local}><Server />Validate on server</Button>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader eyebrow="Failure mode" title="Simulate an edge bypass" description="What if a buggy client skipped tokenization? The server must still catch it." />
          <div className="flex flex-1 flex-col justify-between gap-4 p-5">
            {bypass ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-high-soft p-3.5 text-[13px]">
                <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-high" />Caught {bypass.residual_pii} value(s) server-side</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Object.entries(bypass.counts).map(([k, n]) => <Badge key={k} tone="outline">{PII_LABELS[k] ?? k} · {n}</Badge>)}
                </div>
                <div className="mt-2 text-[12px] text-muted">Logged to the audit chain as <code className="text-[11.5px]">privacy.residual_detected</code>. Nothing reached the LLM.</div>
              </motion.div>
            ) : <p className="text-[13px] text-muted">Sends the raw synthetic text to the local gateway (never to the cloud) to prove the second layer works.</p>}
            <Button variant="secondary" onClick={simulateBypass} loading={validating === "bypass"}><CloudOff />Send raw (bypass test)</Button>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader eyebrow="What the AI sees" title="Outbound model context" />
          <pre className="scroll-thin m-5 mt-4 max-h-[220px] flex-1 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-night p-4 font-mono text-[11.5px] leading-relaxed text-white/80">{aiPayload}</pre>
        </Card>
      </div>
    </>
  );
}

function HighlightLayer({ text, spans }: { text: string; spans: { start: number; end: number; type: string }[] }) {
  const out: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    out.push(text.slice(cursor, s.start));
    out.push(<mark key={i} className="rounded-[3px] bg-critical/15 text-[#ff9a9e] shadow-[inset_0_-1.5px_0_rgba(229,72,77,0.5)]" title={PII_LABELS[s.type]}>{text.slice(s.start, s.end)}</mark>);
    cursor = s.end;
  });
  out.push(text.slice(cursor) + "\n");
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words p-4 font-mono text-[12.5px] leading-[1.7] text-ink-2">
      {out}
    </div>
  );
}

function TokenView({ text }: { text: string }) {
  return <>{text.split(/(\[[A-Z]+_[0-9A-F]{6}\])/g).map((p, i) =>
    /^\[[A-Z]+_[0-9A-F]{6}\]$/.test(p) ? <motion.span key={`${i}-${p}`} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} className="token-chip">{p}</motion.span> : p)}</>;
}
