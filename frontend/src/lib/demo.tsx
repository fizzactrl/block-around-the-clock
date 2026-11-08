import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Health, IncidentStatusPayload } from "./types";

interface DemoState {
  callStarted: boolean; riskDetected: boolean; intervened: boolean; incidentId: string | null;
}
interface DemoCtx extends DemoState {
  mark: (patch: Partial<DemoState>) => void;
  reset: () => void;
  incident: IncidentStatusPayload | null;
  health: Health | null;
  healthError: boolean;
  steps: { key: string; label: string; done: boolean; href: string }[];
}

const KEY = "batc.demo";
const initial: DemoState = { callStarted: false, riskDetected: false, intervened: false, incidentId: null };
const Ctx = createContext<DemoCtx | null>(null);

function load(): DemoState {
  try { return { ...initial, ...JSON.parse(sessionStorage.getItem(KEY) ?? "{}") }; } catch { return initial; }
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(load);
  const [incident, setIncident] = useState<IncidentStatusPayload | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }, [state]);

  useEffect(() => {
    const check = () => api.health().then((h) => { setHealth(h); setHealthError(false); }).catch(() => setHealthError(true));
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state.incidentId) { setIncident(null); return; }
    let alive = true;
    const tick = () => api.status(state.incidentId!).then((s) => alive && setIncident(s)).catch(() => undefined);
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [state.incidentId]);

  const mark = useCallback((patch: Partial<DemoState>) => setState((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setState(initial), []);

  const steps = useMemo(() => {
    const inc = incident?.incident;
    const href = state.incidentId ? `/war-room/${state.incidentId}` : "/war-room";
    return [
      { key: "call", label: "Suspicious call arrives", done: state.callStarted, href: "/live-call" },
      { key: "risk", label: "System detects risk", done: state.riskDetected, href: "/live-call" },
      { key: "intervene", label: "Carrier intervenes", done: state.intervened, href: "/live-call" },
      { key: "privacy", label: "Privacy engine sanitizes", done: !!inc, href: "/privacy" },
      { key: "ai", label: "Nemotron agent assesses", done: !!inc?.agent_assessment, href },
      { key: "contain", label: "Agent executes tools", done: (incident?.actions.length ?? 0) > 0, href },
      { key: "execute", label: "Agent observes & replans to finish", done: !!incident?.agent && incident.agent.status !== "RUNNING", href },
      { key: "report", label: "Incident report delivered", done: !!inc?.report_generated_at,
        href: state.incidentId ? `/reports/${state.incidentId}` : "/reports" },
    ];
  }, [state, incident]);

  return <Ctx.Provider value={{ ...state, mark, reset, incident, health, healthError, steps }}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo outside DemoProvider");
  return v;
}
