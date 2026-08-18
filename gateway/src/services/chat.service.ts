import { HttpError } from "../domain/errors";
import { runRepository, RunRow } from "../repositories/run.repository";
import { TargetConfig } from "../infra/redteam.client";
import { ensureTargetLoaded } from "./target-loader";

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

  async ensureTargetLoaded(
    run: RunRow,
    onStatus?: (text: string) => void,
  ): Promise<{ clientId: string; targetId: string }> {
    const clientId = run.user_id;
    const targetId = await ensureTargetLoaded(
      clientId,
      targetConfigFromRun(run),
      run.target_id,
      onStatus,
    );
    if (targetId !== run.target_id) {
      await runRepository.setTargetId(run.id, targetId);
    }
    return { clientId, targetId };
  },
};
