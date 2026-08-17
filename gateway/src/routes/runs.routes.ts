import { Router } from "express";
import { createRunSchema, chatSchema } from "../domain/dto";
import { validateBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth.middleware";
import { runService } from "../services/run.service";
import { chatService } from "../services/chat.service";
import { authService } from "../services/auth.service";
import { runRepository } from "../repositories/run.repository";
import { streamChatResponse } from "../infra/chat-route";
import { sseHub } from "../infra/sse.hub";

export const runsRouter = Router();

const SSE_HEARTBEAT_MS = 15000;

runsRouter.post(
  "/runs",
  requireAuth,
  validateBody(createRunSchema),
  async (req, res, next) => {
    try {
      const result = await runService.createRun(req.user!.id, req.body);
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  },
);

runsRouter.get("/runs", requireAuth, async (req, res, next) => {
  try {
    res.json(await runService.listRuns(req.user!.id));
  } catch (err) {
    next(err);
  }
});

runsRouter.get("/runs/:id", requireAuth, async (req, res, next) => {
  try {
    const run = await runService.getRun(req.user!.id, req.params.id);
    res.json(run);
  } catch (err) {
    next(err);
  }
});

runsRouter.get("/runs/:id/results", requireAuth, async (req, res, next) => {
  try {
    res.json(await runService.getResults(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

runsRouter.get("/runs/:id/metrics", requireAuth, async (req, res, next) => {
  try {
    res.json(await runService.getMetrics(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

runsRouter.get("/runs/:id/progress", requireAuth, async (req, res, next) => {
  try {
    res.json(await runService.getProgress(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

// Streams a chat turn with the run's target as SSE. POST (not EventSource) so
// the message rides in the body and auth in the normal header; the browser
// consumes it with a streaming fetch.
runsRouter.post(
  "/runs/:id/chat",
  requireAuth,
  validateBody(chatSchema),
  (req, res, next) =>
    streamChatResponse(
      req,
      res,
      next,
      () => chatService.loadRun(req.user!.id, req.params.id),
      (run, onStatus) => chatService.ensureTargetLoaded(run, onStatus),
    ),
);

// EventSource can't send an Authorization header, so the JWT rides in the query.
runsRouter.get("/runs/:id/events", async (req, res, next) => {
  let userId: string;
  try {
    userId = authService.verifyToken(String(req.query.access_token ?? "")).id;
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }

  try {
    const run = await runRepository.findByIdForUser(req.params.id, userId);
    if (!run) {
      return res.status(404).json({ error: "run not found" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const snapshot = { type: "snapshot", status: run.status, error: run.error };
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    sseHub.attach(run.id, res);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), SSE_HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseHub.detach(run.id, res);
    });
  } catch (err) {
    next(err);
  }
});
