// AutoDAN-Turbo's own vocabulary: phases, strategies and HarmBench metrics.
// Mirrors the gateway's shaped payloads under /autodan.

import type { CoarseStatus, RunListItem, TargetKind } from "../../shared/types/run";

export type Phase = "warmup" | "lifelong" | "evaluate";

/** A run list item plus the parameters only AutoDAN-Turbo has. */
export interface RunSummary extends RunListItem {
  phases: Phase[];
  dataset: string[];
  fresh_library: boolean;
  load_4_bits: boolean;
  standard_dataset: string | null;
  standard_dataset_percent: number | null;
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

export interface TrainingPrompt {
  attack_id: string;
  malicious_request: string;
  attack_prompt: string;
  target_response: string;
  score: number | null;
  score_explanation: string | null;
  iteration_number: number;
  strategies_used: string[];
  strategy_source: string;
}

export interface RunPrompts {
  run_id: string;
  status: CoarseStatus;
  // Grouped by training phase; keys present only for phases that ran.
  prompts: Record<string, TrainingPrompt[]>;
}

export interface StrategyProgress {
  strategy_id: string;
  name: string;
  malicious_request: string;
  category: string;
  success_rate: number;
  average_score: number;
  usage_count: number;
  improvement: number | null;
  example_prompt_pi: string;
  example_prompt_pj: string;
  response_i: string;
  response_j: string;
  score_i: number | null;
  score_j: number | null;
}

// One malicious request that finished all its attack iterations in a phase.
export interface RequestScore {
  phase: string;
  request_index: number;
  total_requests: number;
  malicious_request: string;
  attempts: number;
  average_score: number | null;
  best_score: number | null;
  completed_at: string;
}

export interface RunProgress {
  run_id: string;
  status: string;
  total: number;
  loaded_from_library: number | null;
  discovered_this_run: number | null;
  persist_errors: string[];
  request_scores: RequestScore[];
  strategies: StrategyProgress[];
}

export interface CreateRunInput {
  kind: TargetKind;
  model_name: string;
  // kind:"connector" only -- a connector is a standing registration with a
  // running agent behind it, so a run references one instead of describing it.
  connector_target_id?: string;
  phases: Phase[];
  dataset: string[];
  standard_dataset?: "harmbench";
  standard_dataset_percent?: number;
  fresh_library: boolean;
  load_4_bits: boolean;
  endpoint_url?: string;
  api_key?: string;
  prompt_field?: string;
  response_field?: string;
}

export interface CreateRunResponse {
  node_run_id: string;
  status: CoarseStatus;
}

