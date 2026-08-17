import { Job } from "bullmq";
import type { Logger } from "pino";
import { logger } from "../infra/logger";
import { runRepository } from "../repositories/run.repository";
import {
  redTeamClient,
  RedTeamServiceError,
  RedTeamRunStatus,
} from "../infra/redteam.client";
import type { RunJobData } from "../infra/queue";
import { publishRunEvent } from "../infra/run-events";

const TARGET_POLL_MS = 3000;
const RUN_POLL_MS = 4000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Python reports fine-grained phases; the client only needs the coarse machine.
function toCoarseStatus(status: RedTeamRunStatus): string {
  switch (status) {
    case "queued":
      return "queued";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}

async function waitForTarget(clientId: string, targetId: string): Promise<void> {
  for (;;) {
    const health = await redTeamClient.getTargetHealth(clientId, targetId);
    if (health.status === "loaded") return;
    if (health.status === "failed") {
      throw new Error(`target load failed: ${health.error ?? "unknown"}`);
    }
    await sleep(TARGET_POLL_MS);
  }
}

async function pollToTerminal(
  clientId: string,
  nodeRunId: string,
  pythonRunId: string,
  log: Logger,
): Promise<void> {
  let lastCoarse: string | null = null;
  let lastFine: string | null = null;
  let lastDiscovered: number | null = null;
  for (;;) {
    const run = await redTeamClient.getRunStatus(clientId, pythonRunId);
    const coarse = toCoarseStatus(run.status);
    if (coarse !== lastCoarse) {
      await runRepository.setStatus(nodeRunId, coarse);
      lastCoarse = coarse;
    }
    if (run.status !== lastFine) {
      lastFine = run.status;
      log.info({ pythonStatus: run.status, coarse }, "run status");
      await publishRunEvent(nodeRunId, {
        type: "status",
        python_status: run.status,
        coarse,
      });
    }

    try {
      const progress = await redTeamClient.getRunProgress(clientId, pythonRunId);
      if (progress.discovered_this_run !== lastDiscovered) {
        lastDiscovered = progress.discovered_this_run;
        await publishRunEvent(nodeRunId, {
          type: "progress",
          total: progress.total,
          loaded_from_library: progress.loaded_from_library,
          discovered_this_run: progress.discovered_this_run,
        });
      }
    } catch (err) {
      log.debug({ err }, "progress poll failed; continuing");
    }

    if (run.status === "failed") {
      const error = run.error ?? "run failed";
      await runRepository.setError(nodeRunId, error);
      await publishRunEvent(nodeRunId, { type: "failed", error });
      return;
    }
    if (run.status === "completed") {
      await publishRunEvent(nodeRunId, { type: "completed" });
      return;
    }
    await sleep(RUN_POLL_MS);
  }
}

export async function processRun(job: Job<RunJobData>): Promise<void> {
  const { nodeRunId } = job.data;
  const run = await runRepository.findById(nodeRunId);
  if (!run) {
    logger.error({ nodeRunId }, "run row not found; dropping job");
    return;
  }

  const clientId = run.user_id;
  const log = logger.child({ nodeRunId, clientId });

  // Guard against a retry re-launching a run Python already started: if we have
  // its id, skip setup and resume polling.
  let pythonRunId = run.python_run_id;
  if (!pythonRunId) {
    await redTeamClient.createClient(clientId);

    const target = await redTeamClient.registerTarget(clientId, {
      kind: "local",
      model_name: run.model_name,
      load_4_bits: run.load_4_bits,
    });
    await runRepository.setTargetId(nodeRunId, target.target_id);
    log.info({ targetId: target.target_id }, "target registered");

    await waitForTarget(clientId, target.target_id);

    try {
      const started = await redTeamClient.startRun({
        client_id: clientId,
        target_id: target.target_id,
        phases: run.phases,
        dataset: run.dataset,
        fresh_library: run.fresh_library,
      });
      pythonRunId = started.run_id;
    } catch (err) {
      // A 409 is a permanent client error (e.g. evaluate-only against an empty
      // library); a retry cannot fix it, so fail the run and stop.
      if (err instanceof RedTeamServiceError && err.status === 409) {
        await runRepository.setError(nodeRunId, err.body);
        log.warn({ err }, "run rejected by red-team service; not retrying");
        return;
      }
      throw err;
    }
    await runRepository.setPythonRunId(nodeRunId, pythonRunId);
  }

  log.info({ pythonRunId }, "polling run to completion");
  await pollToTerminal(clientId, nodeRunId, pythonRunId, log);
}
