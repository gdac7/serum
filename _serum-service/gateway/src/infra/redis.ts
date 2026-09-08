import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

// maxRetriesPerRequest: null is required by BullMQ — its workers use blocking
// commands that ioredis must not abort mid-wait.
export function createRedisConnection() {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  // ioredis reconnects on its own, but an unhandled "error" event is an
  // uncaught exception that kills the process on any transient Redis blip.
  connection.on("error", (err) => logger.error({ err }, "redis connection error"));
  return connection;
}

export const redisConnection = createRedisConnection();
