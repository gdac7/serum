import { Queue } from "bullmq";
import { redisConnection } from "./redis";

export const RUNS_QUEUE = "runs";

// The job carries only the gateway run id; the worker loads everything else
// from the runs table, so a job that outlives a restart still has fresh state.
export interface RunJobData {
  nodeRunId: string;
}

export const runsQueue = new Queue<RunJobData>(RUNS_QUEUE, {
  connection: redisConnection,
});
