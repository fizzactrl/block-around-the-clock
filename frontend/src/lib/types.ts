export type Severity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "DETECTED" | "ANALYZED" | "CONTAINING" | "CONTAINED" | "ATTENTION_REQUIRED";
export type ActionStatus = "QUEUED" | "EXECUTING" | "SUCCEEDED" | "FAILED";

export interface Health {
  status: string; time: string; database: "mongodb" | "memory"; ai_engine: "nemotron" | "demo"; model: string;
  agent: { enabled: boolean; default_model: string; models: Record<string, string> };
  privacy_policy_version: string;
}

export interface AuditEntry {
  id: string; seq: number; ts: string; event_type: string; summary: string; actor: string;
  incident_id: string | null; data: Record<string, unknown>; simulated: boolean; prev_hash: string; hash: string;
}

export interface ChainStatus { valid: boolean; entries: number; broken_at_seq: number | null; head: string }

export interface IncidentSummary {
  id: string; title: string; status: IncidentStatus; severity: Severity; risk_score: number; threat_type: string;
  source: string; created_at: string; seeded: boolean; actions_total: number; actions_succeeded: number;
}

export interface Dashboard {
  protection: { posture: "protected" | "elevated" | "under_attack"; score: number; label: string };
  metrics: {
    active_incidents: number; threats_detected_24h: number; incidents_contained: number; events_analyzed_24h: number;
    containment_progress: number; actions_succeeded: number; actions_total: number; mean_time_to_contain_s: number | null;
  };
  threat_timeline: { hour: string; label: string; critical: number; high: number; medium: number; low: number }[];
  severity_distribution: { severity: Severity; count: number }[];
  threat_mix: { label: string; count: number }[];
  incidents: IncidentSummary[];
  active_incidents: IncidentSummary[];
  recent_activity: AuditEntry[];
  audit_chain: ChainStatus;
  system: { database: string; generated_at: string };
}

export interface TelemetryEvent {
  id: string; type: string; label: string; channel: "sim" | "voice" | "sms" | "network"; risk_score: number;
  severity: Severity; network: string; cell_id: string; subscriber_token: string; details: string;
  recommendation: string; created_at: string; simulated: boolean;
}
export interface TelemetrySummary {
  total: number; flagged: number; sim_swap_indicators: number; voip_suspicious: number; downgrades: number;
  avg_risk: number; by_type: { label: string; count: number }[];
}

export interface Intervention { key: "duck" | "whisper" | "flash"; label: string; detail: string; threshold: number }
export interface CallLine {
  index: number; speaker: "caller" | "subscriber"; text: string; sanitized_text: string; entities: Record<string, number>;
  at_ms: number; risk_after: number; signals: string[]; interventions: Intervention[];
}
export interface CallScript {
  event_id: string; scenario_id: string; title: string; threat_type: string; synthetic: boolean;
  caller: { display_name: string; number: string; carrier_route: string; location: string; attestation: string; number_token: string };
  subscriber_token: string; initial_risk: number; final_risk: number; severity: Severity;
  metadata_factors: { key: string; label: string; weight: number }[];
  signals: { key: string; label: string; weight: number }[];
  lines: CallLine[]; duration_ms: number;
}
export interface Scenario { id: string; title: string; threat_type: string; caller: string }

export interface ProposedAction { action: string; params: Record<string, string>; priority: number; rationale: string }
export interface Analysis {
  engine: "nemotron" | "demo" | "demo-fallback"; model: string; error: string | null; latency_ms: number;
  decision: {
    severity: Severity; threat_type: string; summary: string; confidence: number; actions: ProposedAction[];
    priority_explanation: string; missing_information: string[];
  };
  policy: { schema_valid: boolean; errors: string[]; accepted: string[]; rejected: (ProposedAction & { reason: string })[] };
  context_sent: Record<string, unknown>;
  server_residual_pii: Record<string, number>;
}

export interface Incident {
  id: string; title: string; source: string; threat_type: string; status: IncidentStatus; severity: Severity;
  risk_score: number; signals: { key: string; label: string; weight: number }[];
  metadata_factors: { key: string; label: string; weight: number }[];
  sanitized_transcript: { speaker: string; text: string }[]; interventions: string[]; evidence_refs: string[];
  privacy: { entities_removed: Record<string, number>; total_removed: number; edge_tokenized: boolean;
             server_residual: Record<string, number>; policy_version?: string };
  analysis: Analysis | null; created_at: string; updated_at: string; contained_at: string | null;
  containment_started_at?: string; report_generated_at: string | null; seeded: boolean;
  agent_state: AgentStatus | null; agent_run_id: string | null; sim_env?: { conditions: Record<string, unknown> };
  agent_assessment?: { severity: Severity; threat_summary: string; objectives: string[] };
}

export interface ContainmentAction {
  id: string; incident_id: string; sequence: number; action: string; params: Record<string, string>; label: string;
  category: "carrier" | "identity" | "credit" | "financial"; target: string; priority: number; rationale: string;
  requested_by: string; status: ActionStatus; attempts: number; scheduled_at: string; started_at: string | null;
  completed_at: string | null; result: { ok: boolean; message: string; reference: string | null; simulated: boolean } | null;
}

export interface IncidentStatusPayload {
  incident: Incident; actions: ContainmentAction[];
  progress: { total: number; succeeded: number; failed: number; executing: number; queued: number; percent: number };
  agent: AgentRun | null;
}

export interface PolicyAction { action: string; label: string; category: string; target: string; params: Record<string, string[]> }

export interface LegalReport {
  report_id: string; incident_id: string; generated_at: string; status: string; disclaimer: string;
  identification: Record<string, string | number | null>;
  summary: string;
  ai_commander: { engine: string; model: string; confidence: number; missing_information: string[] };
  agent_trace: null | { run_id: string; model: string; served_model?: string; status: AgentStatus; turns: number; tokens: number;
    model_latency_ms: number; environment: string[]; error: string | null; engine: string;
    outcome: AgentRun["outcome"]; steps: { n: number; ts: string; kind: string; label: string; detail: string }[] };
  facts: { confirmed: string[]; simulated: string[]; unverified: string[] };
  timeline: { ts: string; event: string; summary: string; actor: string; classification: string; hash: string }[];
  evidence: { ref: string; kind: string; pointer: string; sha256: string }[];
  containment: { total: number; succeeded: number; failed: number;
    actions: { label: string; status: ActionStatus; attempts: number; requested_by: string; completed_at: string | null;
               reference: string | null; message: string | null }[] };
  audit_chain: ChainStatus;
  ftc_draft: { title: string; note: string; fields: { label: string; value: string; source: string }[] };
  regulatory_scope: { note: string; data_categories_involved: { category: string; occurrences: number }[];
                      considerations: string[]; human_review_required: boolean };
}

export interface TokenizeResult {
  tokenized_text: string; entities: { type: string; label: string; start: number; end: number; token: string }[];
  counts: Record<string, number>; residual_pii: number; verdict: "clean" | "tokenized" | "residual_tokenized";
}

/* ── Nemotron agent ─────────────────────────────────────────────────────── */
export type AgentStatus = "RUNNING" | "COMPLETED" | "HUMAN_REQUIRED" | "STOPPED" | "ERROR" | "MAX_TURNS";
export interface AgentObservation { ok: boolean; code: string; message: string; reference?: string | null; blocked?: boolean; action_id?: string }
export type AgentStep =
  | { n: number; ts: string; kind: "context"; content: Record<string, unknown> }
  | { n: number; ts: string; kind: "model_turn"; turn: number; reasoning: string; content: string; latency_ms: number; tokens: number; tool_calls: string[] }
  | { n: number; ts: string; kind: "assessment"; args: { severity: Severity; threat_summary: string; objectives: string[]; rationale: string } }
  | { n: number; ts: string; kind: "tool_call"; tool: string; args: Record<string, string>; replan?: boolean; call_id: string }
  | { n: number; ts: string; kind: "observation"; tool: string; result: AgentObservation; call_id: string }
  | { n: number; ts: string; kind: "final" | "escalation"; tool: string; args: Record<string, unknown> };
export interface AgentRun {
  id: string; incident_id: string; model: string; served_model?: string; mode: "live" | "eval"; status: AgentStatus;
  started_at: string; finished_at: string | null; steps: AgentStep[]; turns: number;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; model_latency_ms: number;
  outcome: { summary?: string; residual_risks?: string[]; reason?: string; blocking_issue?: string; unresolved_failures?: string[] } | null;
  error: string | null; engine: string; environment: string[]; stop_requested_by?: string;
}
export interface EvalScenario { id: string; title: string; summary: string; expect: string; conditions: Record<string, unknown> }
export interface EvalResult {
  id: string; scenario_id: string; incident_id: string; run_id: string; model: string; started_at: string; status: "RUNNING" | "DONE";
  scenario: { id: string; title: string; summary: string; expect: string };
  grade: null | { checks: { name: string; passed: boolean }[]; passed: number; total: number; verdict: "PASS" | "PARTIAL" | "FAIL";
    tool_sequence: string[]; turns: number; tokens: number; model_latency_ms: number; agent_status: AgentStatus };
  run: AgentRun | null; actions: ContainmentAction[];
}
