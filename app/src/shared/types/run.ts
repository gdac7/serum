// Mirrors the gateway's shaped payloads (gateway/src/services/run.service.ts,
// gateway/src/infra/redteam.client.ts) — the frontend never talks to Python.

export type TargetKind = "local" | "api";

export type CoarseStatus = "queued" | "running" | "completed" | "failed";

export type Phase = "warmup" | "lifelong" | "evaluate";

export interface RunSummary {
  node_run_id: string;
  status: CoarseStatus;
  model_name: string;
  phases: Phase[];
  dataset: string[];
  fresh_library: boolean;
  load_4_bits: boolean;
  target_kind: TargetKind;
  endpoint_url: string | null;
  api_key_env: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Generation {
  malicious_request: string;
  attack_prompt: string;
  target_response: string;
  score: number | null;
}

export interface PhaseSummary {
  total_attacks: number;
  successful_attacks: number;
  strategies_discovered: number;
  average_score: number;
  phase_time_minutes: number;
  strategy_names: string[];
}

export interface HarmbenchMetrics {
  asr: number;
  rsr: number;
  n_behaviors: number;
  n_attempts: number;
}

export interface RunResults {
  client_id: string;
  run_id: string;
  target_id: string;
  status: CoarseStatus;
  phases: Record<string, PhaseSummary>;
  generations: Record<string, Generation[]> | null;
  metrics: HarmbenchMetrics | null;
}

export interface CreateRunInput {
  kind: TargetKind;
  model_name: string;
  phases: Phase[];
  dataset: string[];
  fresh_library: boolean;
  load_4_bits: boolean;
  endpoint_url?: string;
  api_key?: string;
  api_key_env?: string;
}

export interface CreateRunResponse {
  node_run_id: string;
  status: CoarseStatus;
}

export interface ChatFrame {
  type: "status" | "token" | "done" | "error";
  text?: string;
  error?: string;
}
