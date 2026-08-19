import { redTeamClient } from "../infra/redteam.client";
import type { ProbeResult } from "../infra/endpoint-probe";

const PROBE_PROMPT = "ping";
const PROBE_TIMEOUT_MS = 30_000;

// Reuses the existing chat route rather than adding a probe endpoint to the
// service: chat already loads the target, calls it once, and reports failures
// as an SSE error frame, which is exactly the question being asked.
export async function probeFromService(
  clientId: string,
  targetId: string,
): Promise<ProbeResult> {
  let upstream: Response;
  try {
    upstream = await redTeamClient.chatStream(clientId, targetId, {
      message: PROBE_PROMPT,
      max_tokens: 16,
    });
  } catch (err) {
    // Every failure here is an answer to "can the service reach it", so none of
    // them should surface as a 500 instead of a result.
    const body = (err as { body?: string })?.body;
    return { ok: false, code: "http_status", message: body || (err as Error).message };
  }

  if (!upstream.body) {
    return { ok: false, code: "bad_shape", message: "the service returned an empty response" };
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const timeout = setTimeout(() => reader.cancel().catch(() => {}), PROBE_TIMEOUT_MS);
  let buffer = "";
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;

        let frame: { type?: string; text?: string; error?: string };
        try {
          frame = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (frame.type === "error") {
          return { ok: false, code: "refused", message: frame.error ?? "the target could not be reached" };
        }
        // status frames carry progress text ("loading target"), not the reply.
        if (frame.type !== "status" && typeof frame.text === "string") text += frame.text;
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }

  if (!text.trim()) {
    return {
      ok: false,
      code: "bad_shape",
      message: "the target answered, but with no text — check the response field",
    };
  }
  return { ok: true, sample: text.trim() };
}
