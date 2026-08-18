import { apiRequest } from "./client";
import type { TargetKind } from "../types/run";

export type TargetStatus = "queued" | "loading" | "loaded" | "failed";

export interface TargetSummary {
  target_id: string;
  kind: TargetKind;
  model_name: string;
  endpoint_url: string | null;
  load_4_bits: boolean;
  status: TargetStatus;
  error: string | null;
  in_use: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegisterTargetInput {
  kind: TargetKind;
  model_name: string;
  load_4_bits?: boolean;
  endpoint_url?: string;
  api_key?: string;
}

export const targetsApi = {
  list: (token: string) => apiRequest<TargetSummary[]>("GET", "/targets", token),

  get: (token: string, id: string) =>
    apiRequest<TargetSummary>("GET", `/targets/${id}`, token),

  register: (token: string, input: RegisterTargetInput) =>
    apiRequest<{ target_id: string; status: TargetStatus }>("POST", "/targets", token, input),
};
