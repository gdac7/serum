import { env } from "../config/env";

export interface RedTeamHealth {
  attacker_name: string;
  summarizer_name: string;
  scorer_name: string;
  loaded_models: string[];
}

export type TargetStatus = "queued" | "loading" | "loaded" | "failed";

export type RedTeamRunStatus =
  | "queued"
  | "warmup"
  | "lifelong"
  | "evaluating"
  | "scoring"
  | "completed"
  | "failed";

export interface CreateClientResponse {
  client_id: string;
  created: boolean;
  libraries: number;
}

export interface TargetConfig {
  kind: "local" | "api";
  model_name: string;
  load_4_bits?: boolean;
  endpoint_url?: string;
  api_key_env?: string;
}

export interface TargetCreateResponse {
  client_id: string;
  target_id: string;
  status: TargetStatus;
}

export interface TargetHealthResponse {
  client_id: string;
  target_id: string;
  status: TargetStatus;
  model_name: string | null;
  error: string | null;
}

export interface StartRunBody {
  client_id: string;
  target_id: string;
  phases: string[];
  dataset: string[];
  fresh_library: boolean;
}

export interface RunCreateResponse {
  client_id: string;
  run_id: string;
  target_id: string;
  status: RedTeamRunStatus;
}

export interface RunStatusResponse {
  client_id: string;
  run_id: string;
  target_id: string;
  status: RedTeamRunStatus;
  error: string | null;
  persist_errors: string[];
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

export interface RunResultsResponse {
  client_id: string;
  run_id: string;
  target_id: string;
  status: RedTeamRunStatus;
  phases: Record<string, PhaseSummary>;
  generations: Record<string, Generation[]> | null;
  metrics: HarmbenchMetrics | null;
}

export interface RunMetricsResponse {
  client_id: string;
  run_id: string;
  target_id: string;
  status: RedTeamRunStatus;
  metrics: HarmbenchMetrics;
}

export interface RunProgressResponse {
  run_id: string;
  status: RedTeamRunStatus;
  total: number;
  loaded_from_library: number | null;
  discovered_this_run: number | null;
  persist_errors: string[];
  strategies: Record<string, unknown>[];
}

// Carries the HTTP status so callers can tell a permanent 4xx (bad request,
// ownership) from a transient failure worth retrying.
export class RedTeamServiceError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`red-team service ${path} responded ${status}: ${body}`);
    this.name = "RedTeamServiceError";
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${env.PYTHON_SERVICE_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new RedTeamServiceError(res.status, path, await res.text());
  }
  return (await res.json()) as T;
}

export const redTeamClient = {
  health: () => request<RedTeamHealth>("GET", "/v1/health"),

  createClient: (clientId: string) =>
    request<CreateClientResponse>("POST", "/v1/create_client", {
      client_id: clientId,
    }),

  registerTarget: (clientId: string, target: TargetConfig) =>
    request<TargetCreateResponse>("POST", "/v1/targets", {
      client_id: clientId,
      target,
    }),

  getTargetHealth: (clientId: string, targetId: string) =>
    request<TargetHealthResponse>(
      "GET",
      `/v1/target_health/${targetId}?client_id=${clientId}`,
    ),

  startRun: (body: StartRunBody) =>
    request<RunCreateResponse>("POST", "/v1/runs", body),

  getRunStatus: (clientId: string, runId: string) =>
    request<RunStatusResponse>(
      "GET",
      `/v1/runs/${runId}?client_id=${clientId}`,
    ),

  getRunResults: (clientId: string, runId: string) =>
    request<RunResultsResponse>(
      "GET",
      `/v1/runs/${runId}/results?client_id=${clientId}`,
    ),

  getRunMetrics: (clientId: string, runId: string) =>
    request<RunMetricsResponse>(
      "GET",
      `/v1/runs/${runId}/metrics?client_id=${clientId}`,
    ),

  getRunProgress: (clientId: string, runId: string) =>
    request<RunProgressResponse>(
      "GET",
      `/v1/runs/${runId}/progress?client_id=${clientId}`,
    ),

  // Returns the raw streaming response so the caller can forward the SSE body
  // frame-by-frame; unlike `request`, it must not buffer the whole reply.
  chatStream: async (
    clientId: string,
    targetId: string,
    body: { message: string; system_prompt?: string; max_tokens?: number; temperature?: number },
  ): Promise<Response> => {
    const path = `/v1/targets/${targetId}/chat`;
    const res = await fetch(`${env.PYTHON_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ client_id: clientId, ...body }),
    });
    if (!res.ok) {
      throw new RedTeamServiceError(res.status, path, await res.text());
    }
    return res;
  },
};
