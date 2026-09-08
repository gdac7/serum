import { apiRequest } from "../../shared/api/client";
import type {
  CreateRunInput,
  CreateRunResponse,
  RunProgress,
  RunPrompts,
  RunResults,
  RunSummary,
} from "./types";

const BASE = "/autodan";

export const autodanApi = {
  get: (token: string, id: string) =>
    apiRequest<RunSummary>("GET", `${BASE}/runs/${id}`, token),

  create: (token: string, input: CreateRunInput) =>
    apiRequest<CreateRunResponse>("POST", `${BASE}/runs`, token, input),

  results: (token: string, id: string) =>
    apiRequest<RunResults>("GET", `${BASE}/runs/${id}/results`, token),

  progress: (token: string, id: string) =>
    apiRequest<RunProgress>("GET", `${BASE}/runs/${id}/progress`, token),

  prompts: (token: string, id: string) =>
    apiRequest<RunPrompts>("GET", `${BASE}/runs/${id}/prompts`, token),
};

// EventSource can't set an Authorization header, so the JWT rides in the query
// string (matches gateway src/approaches/autodan/routes.ts GET /runs/:id/events).
export function subscribeRunEvents(
  token: string,
  runId: string,
  onEvent: (data: Record<string, unknown>) => void,
): () => void {
  const es = new EventSource(
    `${BASE}/runs/${runId}/events?access_token=${encodeURIComponent(token)}`,
  );
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // ignore malformed frames
    }
  };
  return () => es.close();
}
