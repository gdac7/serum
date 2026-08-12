import { Router } from "express";
import { pythonClient } from "../infra/python.client";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    const python = await pythonClient.health();
    res.json({ ok: true, python: { reachable: true, ...python } });
  } catch {
    res.json({ ok: true, python: { reachable: false } });
  }
});
