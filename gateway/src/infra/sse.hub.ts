import type { Response } from "express";
import { createRedisConnection } from "./redis";
import { RUN_CHANNEL_PREFIX } from "./run-events";
import { logger } from "./logger";

const connections = new Map<string, Set<Response>>();

const subscriber = createRedisConnection();
subscriber.psubscribe(`${RUN_CHANNEL_PREFIX}*`).catch((err) => {
  logger.error({ err }, "sse subscriber failed to psubscribe");
});

subscriber.on("pmessage", (_pattern, channel, message) => {
  const nodeRunId = channel.slice(RUN_CHANNEL_PREFIX.length);
  const clients = connections.get(nodeRunId);
  if (!clients) return;
  const frame = `data: ${message}\n\n`;
  for (const res of clients) res.write(frame);
});

export const sseHub = {
  attach(nodeRunId: string, res: Response): void {
    let clients = connections.get(nodeRunId);
    if (!clients) {
      clients = new Set();
      connections.set(nodeRunId, clients);
    }
    clients.add(res);
  },

  detach(nodeRunId: string, res: Response): void {
    const clients = connections.get(nodeRunId);
    if (!clients) return;
    clients.delete(res);
    if (clients.size === 0) connections.delete(nodeRunId);
  },
};
