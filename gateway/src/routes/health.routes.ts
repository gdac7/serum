import { Router } from "express";
import { redTeamClient } from "../infra/redteam.client";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    const redteam = await redTeamClient.health();
    res.json({ ok: true, redteam: { reachable: true, ...redteam } });
  } catch {
    res.json({ ok: true, redteam: { reachable: false } });
  }
});
