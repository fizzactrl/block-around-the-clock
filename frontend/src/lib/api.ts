import type {
  AgentRun, EvalResult, EvalScenario, CallScript, Dashboard, Health, IncidentStatusPayload, IncidentSummary, LegalReport, PolicyAction, Scenario,
  AuditEntry, TelemetryEvent, TelemetrySummary, TokenizeResult,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const UNREACHABLE = BASE
  ? "Cannot reach the defense gateway API. It may still be starting up; try again in a few seconds."
  : "Cannot reach the defense gateway API. Is the backend running on :5050?";

/* Free-tier hosts sleep when idle and take up to ~60s to wake. Before the first real request,
   poll /health until the gateway answers, so pages wait instead of failing. Only health is retried:
   no state-changing request is ever sent twice. */
const WAKE_TIMEOUT_MS = 90_000;
let ready: Promise<void> | null = null;
export function waitForGateway(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const started = Date.now();
      for (let delay = 1000; ; delay = Math.min(delay * 1.5, 5000)) {
        try {
          const r = await fetch(`${BASE}/api/health`, { cache: "no-store" });
          if (r.ok) return;
        } catch { /* still waking */ }
        if (Date.now() - started > WAKE_TIMEOUT_MS) throw new ApiError(0, "network_error", UNREACHABLE);
        await new Promise((res) => setTimeout(res, delay));
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await waitForGateway();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    ready = null; // re-check the gateway before the next request
    throw new ApiError(0, "network_error", UNREACHABLE);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? "http_error", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return body.data as T;
}

const post = <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) });

export const api = {
  health: () => request<Health>("/health"),
  dashboard: () => request<Dashboard>("/dashboard"),
  scenarios: () => request<Scenario[]>("/scenarios"),
  simulateCall: (scenario_id: string) => post<CallScript>("/simulate-call", { scenario_id }),
  tokenize: (text: string, client_tokenized: boolean) => post<TokenizeResult>("/tokenize", { text, client_tokenized }),
  triggerIncident: (payload: Record<string, unknown>) => post<IncidentStatusPayload>("/trigger-incident", payload),
  analyze: (incident_id: string) => post<IncidentStatusPayload>("/analyze-threat", { incident_id }),
  incidents: () => request<IncidentSummary[]>("/incidents"),
  status: (id: string) => request<IncidentStatusPayload>(`/incident-status/${id}`),
  contain: (id: string, approved?: string[]) =>
    post<IncidentStatusPayload>(`/incidents/${id}/contain`, { approved, operator: "war-room-operator" }),
  manualAction: (id: string, action: string, params: Record<string, string> = {}) =>
    post<IncidentStatusPayload>(`/incidents/${id}/actions`, { action, params, operator: "war-room-operator" }),
  retry: (id: string, actionId: string) =>
    post<IncidentStatusPayload>(`/incidents/${id}/actions/${actionId}/retry`, { operator: "war-room-operator" }),
  timeline: (id: string) => request<{ incident_id: string; events: AuditEntry[] }>(`/incidents/${id}/timeline`),
  report: (id: string) => request<LegalReport>(`/legal-report/${id}`),
  reportPdfUrl: (id: string) => `${BASE}/api/legal-report/${id}/pdf`,
  telemetry: (limit = 60) => request<{ events: TelemetryEvent[]; summary: TelemetrySummary }>(`/telemetry/events?limit=${limit}`),
  simulateTelemetry: (count = 1) => post<{ events: TelemetryEvent[]; summary: TelemetrySummary }>("/telemetry/simulate", { count }),
  policyActions: () => request<PolicyAction[]>("/policy/actions"),
  startAgent: (id: string, model?: string) => post<AgentRun>(`/incidents/${id}/agent`, { model, operator: "war-room-operator" }),
  stopAgent: (runId: string) => post<AgentRun>(`/agent-runs/${runId}/stop`, { operator: "war-room-operator" }),
  evalScenarios: () => request<EvalScenario[]>("/eval/scenarios"),
  runEval: (scenario_id: string, model?: string) => post<EvalResult>("/eval/run", { scenario_id, model }),
  evalRuns: () => request<EvalResult[]>("/eval/runs"),
  evalRun: (id: string) => request<EvalResult>(`/eval/runs/${id}`),
};
