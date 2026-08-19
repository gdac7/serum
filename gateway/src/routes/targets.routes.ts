import { Router } from "express";
import { registerTargetSchema, chatSchema } from "../domain/dto";
import { validateBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth.middleware";
import { targetService } from "../services/target.service";
import { connectorService } from "../services/connector.service";
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

// Declared before "/targets/:id" routes so "probe" is never read as an id.
targetsRouter.post(
  "/targets/probe",
  requireAuth,
  validateBody(registerTargetSchema),
  async (req, res, next) => {
    try {
      res.json(await targetService.probe(req.body));
    } catch (err) {
      next(err);
    }
  },
);

targetsRouter.post("/targets/:id/test", requireAuth, async (req, res, next) => {
  try {
    res.json(await targetService.test(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

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

// The token is returned only by this route, and only at issue time -- it is
// stored hashed, so a lost token is replaced rather than recovered.
targetsRouter.post("/targets/:id/connector", requireAuth, async (req, res, next) => {
  try {
    res.status(201).json(await connectorService.issue(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

targetsRouter.get("/targets/:id/connector", requireAuth, async (req, res, next) => {
  try {
    res.json(await connectorService.status(req.user!.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

targetsRouter.delete("/targets/:id/connector", requireAuth, async (req, res, next) => {
  try {
    await connectorService.revoke(req.user!.id, req.params.id);
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
