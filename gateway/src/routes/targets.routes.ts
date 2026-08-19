import { Router } from "express";
import { registerTargetSchema, chatSchema } from "../domain/dto";
import { validateBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth.middleware";
import { targetService } from "../services/target.service";
import { streamChatResponse } from "../infra/chat-route";

export const targetsRouter = Router();

// Registers and loads a target with no attack attached — unlike POST /runs,
// which always starts an AutoDAN-Turbo run once its target is loaded. Lets a
// user probe a model from Chat without starting a real test.
targetsRouter.post(
  "/targets",
  requireAuth,
  validateBody(registerTargetSchema),
  async (req, res, next) => {
    try {
      const result = await targetService.register(req.user!.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

targetsRouter.get("/targets", requireAuth, async (req, res, next) => {
  try {
    res.json(await targetService.list(req.user!.id));
  } catch (err) {
    next(err);
  }
});

targetsRouter.get("/targets/:id", requireAuth, async (req, res, next) => {
  try {
    res.json(await targetService.refresh(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

targetsRouter.delete("/targets/:id", requireAuth, async (req, res, next) => {
  try {
    await targetService.remove(req.user!.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

targetsRouter.post(
  "/targets/:id/chat",
  requireAuth,
  validateBody(chatSchema),
  (req, res, next) =>
    streamChatResponse(
      req,
      res,
      next,
      () => targetService.loadTarget(req.user!.id, req.params.id),
      (target, onStatus) => targetService.ensureLoaded(target, onStatus),
    ),
);
