import { Router, json } from "express";
import { z } from "zod";
import { requireConnector } from "../middleware/connector-auth";
import { validateBody } from "../middleware/validate";
import { connectorHub } from "../infra/connector.hub";
import { connectorRepository } from "../repositories/connector.repository";

export const connectRouter = Router();

// Long enough to be worth a round trip, short enough to stay under the 30s idle
// timeout that load balancers and corporate proxies commonly impose.
const DEFAULT_WAIT_SECONDS = 25;
const MAX_WAIT_SECONDS = 55;

const resultSchema = z.object({
  job_id: z.string().uuid(),
  output: z.string().optional(),
  error: z.string().optional(),
});

connectRouter.get("/connect/poll", requireConnector, async (req, res, next) => {
  try {
    const requested = Number(req.query.wait ?? DEFAULT_WAIT_SECONDS);
    const wait = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), MAX_WAIT_SECONDS)
      : DEFAULT_WAIT_SECONDS;

    // Before blocking, so a connector polling an idle target still reports in and
    // the target shows as online.
    await connectorRepository.touch(req.connector!.id);

    const job = await connectorHub.takeJob(req.connector!.target_id, wait);
    if (!job) return res.status(204).end();

    res.json({ job_id: job.job_id, prompt: job.prompt });
  } catch (err) {
    next(err);
  }
});

connectRouter.post(
  "/connect/result",
  json({ limit: "2mb" }),
  requireConnector,
  validateBody(resultSchema),
  async (req, res, next) => {
    try {
      const { job_id, output, error } = req.body as z.infer<typeof resultSchema>;
      await connectorHub.reply(
        job_id,
        output !== undefined ? { output } : { error: error || "the connector reported a failure" },
      );
      res.status(202).end();
    } catch (err) {
      next(err);
    }
  },
);
