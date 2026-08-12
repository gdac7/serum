import { Router } from "express";
import { createRunSchema } from "../domain/dto";
import { validateBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth.middleware";
import { runService } from "../services/run.service";

export const runsRouter = Router();

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

runsRouter.get("/runs/:id", requireAuth, async (req, res, next) => {
  try {
    const run = await runService.getRun(req.user!.id, req.params.id);
    res.json(run);
  } catch (err) {
    next(err);
  }
});
