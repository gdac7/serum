import { Router, json } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { validateBody } from "../middleware/validate";
import { connectorHub } from "../infra/connector.hub";
import { connectorService } from "../services/connector.service";
import { logger } from "../infra/logger";

export const bridgeRouter = Router();

// Matches RemoteModelAPI's own timeout: the service gives up at 300s, so holding
// the request open past that only wastes a socket.
const BRIDGE_TIMEOUT_MS = 300_000;

const bridgeSchema = z.object({ input_text: z.string() });

// The red-team service reaches this over the private network and presents the
// shared secret the gateway put in the target's api_key. It is not a user
// credential: ownership was settled when the target was registered.
function authorised(header: string | undefined): boolean {
  return header === `Bearer ${env.BRIDGE_SECRET}`;
}

bridgeRouter.post(
  "/bridge/targets/:id",
  json({ limit: "2mb" }),
  validateBody(bridgeSchema),
  async (req, res, next) => {
    if (!authorised(req.headers.authorization)) {
      return res.status(401).json({ error: "invalid bridge credentials" });
    }

    try {
      const targetId = req.params.id;
      if (!(await connectorService.onlineForTarget(targetId))) {
        return res.status(503).json({
          error:
            "no connector is running for this target — start redteam-connect on the machine hosting the model",
        });
      }

      const reply = await connectorHub.dispatch(
        targetId,
        req.body.input_text,
        BRIDGE_TIMEOUT_MS,
      );

      if ("error" in reply) {
        logger.warn({ targetId, error: reply.error }, "connector job failed");
        return res.status(504).json({ error: reply.error });
      }
      res.json({ output: reply.output });
    } catch (err) {
      next(err);
    }
  },
);
