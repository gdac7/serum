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
};
