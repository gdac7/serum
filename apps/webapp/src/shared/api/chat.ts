import { ApiError } from "./client";
import { decodeHtmlEntities } from "../utils/html-entities";
import type { ChatFrame } from "../types/run";

export interface ChatTurnInput {
  message: string;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
}

// The chat endpoint streams SSE over a POST response, so it can't use
// EventSource (GET-only, no body/headers) — read the fetch body stream instead.
// Shared by run-scoped chat (/runs/:id/chat) and standalone-target chat
// (/targets/:id/chat), which have the same SSE frame contract.
export async function streamChat(
  token: string,
  path: string,
  input: ChatTurnInput,
  onFrame: (frame: ChatFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
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
        const frame = JSON.parse(json) as ChatFrame;
        // The gateway HTML-escapes text/error (infra/sanitize.ts) as transport-
        // level XSS defense for consumers that might render raw HTML. This app
        // never does (plain React text nodes, already auto-escaped), so decode
        // here or entities show up literally, e.g. "It&#39;s" instead of "It's".
        if (frame.text) frame.text = decodeHtmlEntities(frame.text);
        if (frame.error) frame.error = decodeHtmlEntities(frame.error);
        onFrame(frame);
      } catch {
        // ignore malformed frame
      }
    }
  }
}
