import type { Response as ExpressResponse } from "express";
import { escapeHtml } from "./sanitize";

// Read the Python service's SSE chat stream, sanitize the free-text fields, and
// re-emit each frame to the browser. Frames are `data: {json}\n\n`; a `text` or
// `error` field is escaped since it carries raw (adversarial) model output.
export async function pipeChatSse(
  upstream: Response,
  res: ExpressResponse,
  isClosed: () => boolean,
): Promise<void> {
  if (!upstream.body) return;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    if (isClosed()) {
      await reader.cancel().catch(() => {});
      return;
    }
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

      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(json);
      } catch {
        continue;
      }
      if (typeof frame.text === "string") frame.text = escapeHtml(frame.text);
      if (typeof frame.error === "string") frame.error = escapeHtml(frame.error);
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
  }
}
