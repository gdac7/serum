import { apiRequest } from "./client";
import type { TargetKind } from "../types/run";

export type TargetStatus = "queued" | "loading" | "loaded" | "failed";

export interface TargetSummary {
  target_id: string;
  kind: TargetKind;
  model_name: string;
  endpoint_url: string | null;
  prompt_field: string | null;
  response_field: string | null;
  load_4_bits: boolean;
  status: TargetStatus;
  error: string | null;
  in_use: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConnectorStatus {
  configured: boolean;
  online: boolean;
  last_seen_at: string | null;
}

export interface RegisterTargetInput {
  kind: TargetKind;
  model_name: string;
  load_4_bits?: boolean;
  endpoint_url?: string;
  api_key?: string;
  prompt_field?: string;
  response_field?: string;
}

export type ProbeResult =
  | { ok: true; sample: string }
  | { ok: false; code: string; message: string };

export const targetsApi = {
  list: (token: string) => apiRequest<TargetSummary[]>("GET", "/targets", token),

  get: (token: string, id: string) =>
    apiRequest<TargetSummary>("GET", `/targets/${id}`, token),

  register: (token: string, input: RegisterTargetInput) =>
    apiRequest<{ target_id: string; status: TargetStatus }>("POST", "/targets", token, input),

  probe: (token: string, input: RegisterTargetInput) =>
    apiRequest<ProbeResult>("POST", "/targets/probe", token, input),

  test: (token: string, id: string) =>
    apiRequest<ProbeResult>("POST", `/targets/${id}/test`, token),

  issueConnector: (token: string, id: string) =>
    apiRequest<{ token: string; command: string }>(
      "POST",
      `/targets/${id}/connector`,
      token,
    ),

  connectorStatus: (token: string, id: string) =>
    apiRequest<ConnectorStatus>("GET", `/targets/${id}/connector`, token),

  remove: (token: string, id: string) =>
    apiRequest<void>("DELETE", `/targets/${id}`, token),
};
