import { HttpError } from "../domain/errors";
import { runRepository, RunRow } from "../repositories/run.repository";
import { redTeamClient, TargetConfig } from "../infra/redteam.client";

const TARGET_POLL_MS = 3000;
const TARGET_LOAD_TIMEOUT_MS = 120000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function targetConfigFromRun(run: RunRow): TargetConfig {
  return run.target_kind === "api"
    ? {
        kind: "api",
        model_name: run.model_name,
        endpoint_url: run.endpoint_url ?? undefined,
        api_key_env: run.api_key_env ?? undefined,
      }
    : { kind: "local", model_name: run.model_name, load_4_bits: run.load_4_bits };
}

export const chatService = {
  async loadRun(userId: string, runId: string): Promise<RunRow> {
    const run = await runRepository.findByIdForUser(runId, userId);
    if (!run) throw new HttpError(404, "run not found");
    return run;
  },

  // Chat needs the target live on the Python service, which drops all target
  // weights on restart. So (re-)register the run's target config — idempotent,
  // same config yields the same target_id — and wait for it to load before
  // streaming. `onStatus` surfaces the wait to the client while it happens.
  async ensureTargetLoaded(
    run: RunRow,
    onStatus?: (text: string) => void,
  ): Promise<{ clientId: string; targetId: string }> {
    const clientId = run.user_id;

    if (run.target_id) {
      const health = await redTeamClient.getTargetHealth(clientId, run.target_id);
      if (health.status === "loaded") {
        return { clientId, targetId: run.target_id };
      }
    }

    onStatus?.("loading target");
    await redTeamClient.createClient(clientId);
    const target = await redTeamClient.registerTarget(clientId, targetConfigFromRun(run));
    const targetId = target.target_id;
    if (targetId !== run.target_id) {
      await runRepository.setTargetId(run.id, targetId);
    }

    const deadline = Date.now() + TARGET_LOAD_TIMEOUT_MS;
    for (;;) {
      const health = await redTeamClient.getTargetHealth(clientId, targetId);
      if (health.status === "loaded") return { clientId, targetId };
      if (health.status === "failed") {
        throw new HttpError(502, `target failed to load: ${health.error ?? "unknown"}`);
      }
      if (Date.now() > deadline) {
        throw new HttpError(504, "target did not finish loading in time");
      }
      await sleep(TARGET_POLL_MS);
    }
  },
};
