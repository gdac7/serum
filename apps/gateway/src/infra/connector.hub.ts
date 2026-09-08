import { randomUUID } from "node:crypto";
import { createRedisConnection, redisConnection } from "./redis";
import { logger } from "./logger";

export interface ConnectorJob {
  job_id: string;
  prompt: string;
  expires_at: number;
}

export type ConnectorReply = { output: string } | { error: string };

const REPLY_PREFIX = "connector:reply:";

function jobsKey(targetId: string): string {
  return `connector:jobs:${targetId}`;
}

// A job outlives no request but its own, so the queue is cleared out on the same
// clock as the caller's timeout rather than growing while a connector is away.
const JOBS_KEY_TTL_SECONDS = 600;

const pending = new Map<string, (reply: ConnectorReply) => void>();

const subscriber = createRedisConnection();
subscriber.psubscribe(`${REPLY_PREFIX}*`).catch((err) => {
  logger.error({ err }, "connector subscriber failed to psubscribe");
});

// The waiting HTTP request is pinned to whichever process holds its socket, and
// every process sees the pattern message, so only the right one has a resolver.
subscriber.on("pmessage", (_pattern, channel, message) => {
  const jobId = channel.slice(REPLY_PREFIX.length);
  const resolve = pending.get(jobId);
  if (!resolve) return;
  pending.delete(jobId);
  try {
    resolve(JSON.parse(message) as ConnectorReply);
  } catch (err) {
    logger.error({ err, jobId }, "connector reply was not valid json");
    resolve({ error: "connector sent a malformed reply" });
  }
});

export const connectorHub = {
  /** Queues a prompt for the target's connector and waits for it to answer. */
  async dispatch(targetId: string, prompt: string, timeoutMs: number): Promise<ConnectorReply> {
    const jobId = randomUUID();
    const job: ConnectorJob = {
      job_id: jobId,
      prompt,
      expires_at: Date.now() + timeoutMs,
    };

    const reply = new Promise<ConnectorReply>((resolve) => {
      pending.set(jobId, resolve);
      setTimeout(() => {
        if (!pending.delete(jobId)) return;
        resolve({ error: "the connector did not answer in time" });
      }, timeoutMs).unref();
    });

    const key = jobsKey(targetId);
    await redisConnection
      .multi()
      .lpush(key, JSON.stringify(job))
      .expire(key, JOBS_KEY_TTL_SECONDS)
      .exec();

    return reply;
  },

  /**
   * Blocks until the target has work or `waitSeconds` elapses. Uses its own
   * connection: BRPOP holds the socket, and the shared client serves everything
   * else in the process.
   */
  async takeJob(targetId: string, waitSeconds: number): Promise<ConnectorJob | null> {
    const connection = createRedisConnection();
    try {
      const deadline = Date.now() + waitSeconds * 1000;
      while (Date.now() < deadline) {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        const popped = await connection.brpop(jobsKey(targetId), Math.max(1, remaining));
        if (!popped) return null;

        const job = JSON.parse(popped[1]) as ConnectorJob;
        // Whoever queued it has already given up and answered its own caller.
        if (job.expires_at > Date.now()) return job;
      }
      return null;
    } finally {
      connection.disconnect();
    }
  },

  async reply(jobId: string, reply: ConnectorReply): Promise<void> {
    await redisConnection.publish(`${REPLY_PREFIX}${jobId}`, JSON.stringify(reply));
  },

  /** Releases the subscriber connection so a process can exit. */
  close(): void {
    subscriber.disconnect();
  },
};
