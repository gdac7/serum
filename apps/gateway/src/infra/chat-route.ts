import type { NextFunction, Request, Response } from "express";
import { redTeamClient, RedTeamServiceError } from "./redteam.client";
import { pipeChatSse } from "./chat-stream";
import { HttpError } from "../domain/errors";

// Shared by the run-scoped and standalone-target chat routes: both stream a
// chat turn as SSE the same way, differing only in how the target to chat
// with is loaded and ownership-checked.
export async function streamChatResponse<T>(
  req: Request,
  res: Response,
  next: NextFunction,
  load: () => Promise<T>,
  ensureLoaded: (
    entity: T,
    onStatus: (text: string) => void,
  ) => Promise<{ clientId: string; targetId: string }>,
): Promise<void> {
  let entity: T;
  try {
    entity = await load();
  } catch (err) {
    next(err);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  const write = (obj: unknown) => {
    if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    const { clientId, targetId } = await ensureLoaded(entity, (text) => write({ type: "status", text }));
    if (closed) return;
    const upstream = await redTeamClient.chatStream(clientId, targetId, req.body);
    await pipeChatSse(upstream, res, () => closed);
  } catch (err) {
    const detail =
      err instanceof RedTeamServiceError
        ? err.body
        : err instanceof HttpError
          ? err.message
          : "chat failed";
    write({ type: "error", error: detail });
  } finally {
    if (!closed) res.end();
  }
}
