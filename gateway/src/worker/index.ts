import { Worker } from "bullmq";
import { RUNS_QUEUE, RunJobData } from "../infra/queue";
import { createRedisConnection } from "../infra/redis";
import { processRun } from "./run.processor";
import { runRepository } from "../repositories/run.repository";
import { pool } from "../infra/db/pool";
import { logger } from "../infra/logger";

async function main() {
  await pool.query("SELECT 1");
  logger.info("worker database connection ok");

  // One run at a time: the red-team service serializes on a single GPU, so more
  // concurrency here just piles up runs waiting on its lock.
  const worker = new Worker<RunJobData>(RUNS_QUEUE, processRun, {
    connection: createRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, nodeRunId: job.data.nodeRunId },
      "run job completed",
    );
  });

  // Same reason as the redis client: an unhandled "error" event would take the
  // whole worker down, and under a supervisor that survives it the queue would
  // silently stop being consumed.
  worker.on("error", (err) => {
    logger.error({ err }, "run worker error");
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    logger.error(
      { jobId: job.id, nodeRunId: job.data.nodeRunId, err },
      "run job attempt failed",
    );
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (exhausted) {
      await runRepository
        .setError(job.data.nodeRunId, err.message)
        .catch((dbErr) => logger.error({ dbErr }, "could not persist run failure"));
    }
  });

  logger.info("run worker listening");
}

main().catch((err) => {
  logger.error({ err }, "failed to start worker");
  process.exit(1);
});
