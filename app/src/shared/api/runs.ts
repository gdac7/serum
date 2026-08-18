import { apiRequest } from "./client";
import type { CreateRunInput, CreateRunResponse, RunResults, RunSummary } from "../types/run";

export const runsApi = {
  list: (token: string) => apiRequest<RunSummary[]>("GET", "/runs", token),

  get: (token: string, id: string) =>
    apiRequest<RunSummary>("GET", `/runs/${id}`, token),

  create: (token: string, input: CreateRunInput) =>
    apiRequest<CreateRunResponse>("POST", "/runs", token, input),

  results: (token: string, id: string) =>
    apiRequest<RunResults>("GET", `/runs/${id}/results`, token),
};

// EventSource can't set an Authorization header, so the JWT rides in the query
// string (matches gateway/src/routes/runs.routes.ts GET /runs/:id/events).
export function subscribeRunEvents(
  token: string,
  runId: string,
  onEvent: (data: Record<string, unknown>) => void,
): () => void {
  const es = new EventSource(
    `/runs/${runId}/events?access_token=${encodeURIComponent(token)}`,
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
