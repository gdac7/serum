import { Redis } from "ioredis";
import { env } from "../config/env";

// maxRetriesPerRequest: null is required by BullMQ — its workers use blocking
// commands that ioredis must not abort mid-wait.
export function createRedisConnection() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export const redisConnection = createRedisConnection();
