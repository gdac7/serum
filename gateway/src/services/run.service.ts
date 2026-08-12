import { HttpError } from "../domain/errors";
import type { CreateRunInput } from "../domain/dto";
import { runRepository, RunRow } from "../repositories/run.repository";
import { runsQueue } from "../infra/queue";

function shapeRun(run: RunRow) {
  return {
    node_run_id: run.id,
    status: run.status,
    model_name: run.model_name,
    phases: run.phases,
    error: run.error,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

export const runService = {
  async createRun(userId: string, input: CreateRunInput) {
    const run = await runRepository.create({
      userId,
      modelName: input.model_name,
      phases: input.phases,
      dataset: input.dataset,
      freshLibrary: input.fresh_library,
      load4Bits: input.load_4_bits,
    });

    await runsQueue.add(
      "run",
      { nodeRunId: run.id },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );

    return { node_run_id: run.id, status: run.status };
  },

  async getRun(userId: string, id: string) {
    const run = await runRepository.findByIdForUser(id, userId);
    if (!run) {
      throw new HttpError(404, "run not found");
    }
    return shapeRun(run);
  },
};
