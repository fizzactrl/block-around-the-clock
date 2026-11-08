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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "network_error", "Cannot reach the defense gateway API. Is the backend running on :5050?");
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
