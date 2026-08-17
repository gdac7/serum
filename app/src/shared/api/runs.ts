import { apiRequest, ApiError } from "./client";
import type {
  ChatFrame,
  CreateRunInput,
  CreateRunResponse,
  RunResults,
  RunSummary,
} from "../types/run";

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

export interface ChatTurnInput {
  message: string;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
}

// The chat endpoint streams SSE over a POST response, so it can't use
// EventSource (GET-only, no body/headers) — read the fetch body stream instead.
export async function streamChat(
  token: string,
  runId: string,
  input: ChatTurnInput,
  onFrame: (frame: ChatFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/runs/${runId}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const json = await res.json();
      detail = json.error ?? detail;
    } catch {
      // body wasn't JSON (or already consumed); fall back to statusText
    }
    throw new ApiError(res.status, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        onFrame(JSON.parse(json) as ChatFrame);
      } catch {
        // ignore malformed frame
      }
    }
  }
}
