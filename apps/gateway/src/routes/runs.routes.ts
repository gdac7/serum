import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { runService } from "../services/run.service";

export const runsRouter = Router();

// Deliberately outside any approach prefix: this is the cross-approach run
// list the Results page is built on. Each row carries `approach`, and the
// client uses it to link into that approach's own result views.
runsRouter.get("/runs", requireAuth, async (req, res, next) => {
  try {
    res.json(await runService.listRuns(req.user!.id));
  } catch (err) {
    next(err);
  }
});
