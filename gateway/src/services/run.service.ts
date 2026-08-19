import { HttpError } from "../domain/errors";
import type { CreateRunInput } from "../domain/dto";
import { runRepository, RunRow } from "../repositories/run.repository";
import { runsQueue } from "../infra/queue";
import { redTeamClient, RedTeamServiceError } from "../infra/redteam.client";
import { encrypt } from "../infra/crypto";
import { assertEndpointReachable } from "./endpoint-check";
import { targetRepository } from "../repositories/target.repository";

function shapeRun(run: RunRow) {
  return {
    node_run_id: run.id,
    status: run.status,
    model_name: run.model_name,
    phases: run.phases,
    dataset: run.dataset,
    fresh_library: run.fresh_library,
    load_4_bits: run.load_4_bits,
    target_kind: run.target_kind,
    endpoint_url: run.endpoint_url,
    standard_dataset: run.standard_dataset,
    standard_dataset_percent: run.standard_dataset_percent,
    error: run.error,
    created_at: run.created_at,
    updated_at: run.updated_at,
    started_at: run.started_at,
    ended_at: run.ended_at,
  };
}

async function loadRun(userId: string, id: string): Promise<RunRow> {
  const run = await runRepository.findByIdForUser(id, userId);
  if (!run) {
    throw new HttpError(404, "run not found");
  }
  return run;
}

// Python owns run details; a run that never reached it (no python_run_id) has
// nothing to fetch, and any RedTeamServiceError should surface as its own status.
async function fromPython<T>(
  run: RunRow,
  call: (clientId: string, pythonRunId: string) => Promise<T>,
): Promise<T> {
  if (!run.python_run_id) {
    throw new HttpError(409, "run not started");
  }
  try {
    return await call(run.user_id, run.python_run_id);
  } catch (err) {
    if (err instanceof RedTeamServiceError) {
      throw new HttpError(err.status, err.body);
    }
    throw err;
  }
}

export const runService = {
  async createRun(userId: string, input: CreateRunInput) {
    await assertEndpointReachable(input);

    // Fail here rather than in the worker: a run whose connector target is not
    // the caller's would otherwise queue, start, and only then 404 out of view.
    if (input.kind === "connector") {
      const target = await targetRepository.findByIdForUser(input.connector_target_id!, userId);
      if (!target || target.kind !== "connector") {
        throw new HttpError(404, "connector target not found");
      }
    }

    const run = await runRepository.create({
      userId,
      modelName: input.model_name,
      phases: input.phases,
      dataset: input.dataset,
      freshLibrary: input.fresh_library,
      load4Bits: input.load_4_bits,
      targetKind: input.kind,
      connectorTargetId: input.connector_target_id ?? null,
      endpointUrl: input.endpoint_url ?? null,
      encryptedApiKey: input.api_key ? encrypt(input.api_key) : null,
      promptField: input.prompt_field ?? null,
      responseField: input.response_field ?? null,
      standardDataset: input.standard_dataset ?? null,
      standardDatasetPercent: input.standard_dataset_percent ?? null,
    });

    await runsQueue.add(
      "run",
      { nodeRunId: run.id },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );

    return { node_run_id: run.id, status: run.status };
  },

  async listRuns(userId: string) {
    const runs = await runRepository.listByUser(userId);
    return runs.map(shapeRun);
  },

  async getRun(userId: string, id: string) {
    return shapeRun(await loadRun(userId, id));
  },

  async getResults(userId: string, id: string) {
    const run = await loadRun(userId, id);
    return fromPython(run, (clientId, pythonRunId) =>
      redTeamClient.getRunResults(clientId, pythonRunId),
    );
  },

  async getPrompts(userId: string, id: string) {
    const run = await loadRun(userId, id);
    return fromPython(run, (clientId, pythonRunId) =>
      redTeamClient.getRunPrompts(clientId, pythonRunId),
    );
  },

  async getMetrics(userId: string, id: string) {
    const run = await loadRun(userId, id);
    return fromPython(run, (clientId, pythonRunId) =>
      redTeamClient.getRunMetrics(clientId, pythonRunId),
    );
  },

  async getProgress(userId: string, id: string) {
    const run = await loadRun(userId, id);
    return fromPython(run, (clientId, pythonRunId) =>
      redTeamClient.getRunProgress(clientId, pythonRunId),
    );
  },
};
