import { Router } from "express";
import { APPROACHES } from "../approaches/registry";

export const approachesRouter = Router();

// Unauthenticated: which techniques this deployment offers is not user data,
// and the web app reads it to build its picker before anyone logs in.
approachesRouter.get("/approaches", (_req, res) => {
  res.json({
    approaches: APPROACHES.map(({ id, name, description }) => ({ id, name, description })),
  });
});
