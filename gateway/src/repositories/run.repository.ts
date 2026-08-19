import { pool } from "../infra/db/pool";

export interface RunRow {
  id: string;
  user_id: string;
  python_run_id: string | null;
  target_id: string | null;
  status: string;
  model_name: string;
  phases: string[];
  dataset: string[];
  fresh_library: boolean;
  load_4_bits: boolean;
  target_kind: string;
  connector_target_id: string | null;
  endpoint_url: string | null;
  encrypted_api_key: string | null;
  prompt_field: string | null;
  response_field: string | null;
  standard_dataset: string | null;
  standard_dataset_percent: number | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
}

export interface NewRun {
  userId: string;
  modelName: string;
  phases: string[];
  dataset: string[];
  freshLibrary: boolean;
  load4Bits: boolean;
  targetKind: string;
  connectorTargetId: string | null;
  endpointUrl: string | null;
  encryptedApiKey: string | null;
  promptField: string | null;
  responseField: string | null;
  standardDataset: string | null;
  standardDatasetPercent: number | null;
}

export const runRepository = {
  async create(run: NewRun): Promise<RunRow> {
    const { rows } = await pool.query<RunRow>(
      `INSERT INTO runs
         (user_id, model_name, phases, dataset, fresh_library, load_4_bits,
          target_kind, connector_target_id, endpoint_url, encrypted_api_key,
          prompt_field, response_field, standard_dataset, standard_dataset_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        run.userId,
        run.modelName,
        run.phases,
        run.dataset,
        run.freshLibrary,
        run.load4Bits,
        run.targetKind,
        run.connectorTargetId,
        run.endpointUrl,
        run.encryptedApiKey,
        run.promptField,
        run.responseField,
        run.standardDataset,
        run.standardDatasetPercent,
      ],
    );
    return rows[0];
  },

  async findById(id: string): Promise<RunRow | null> {
    const { rows } = await pool.query<RunRow>(
      "SELECT * FROM runs WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  },

  async listByUser(userId: string): Promise<RunRow[]> {
    const { rows } = await pool.query<RunRow>(
      "SELECT * FROM runs WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows;
  },

  // Python target ids the user currently has a non-terminal run against; a
  // target in this set is busy (the run holds the GPU) and can't be chatted.
  async activeTargetIds(userId: string): Promise<string[]> {
    const { rows } = await pool.query<{ target_id: string }>(
      `SELECT DISTINCT target_id FROM runs
       WHERE user_id = $1 AND target_id IS NOT NULL
         AND status NOT IN ('completed', 'failed')`,
      [userId],
    );
    return rows.map((r) => r.target_id);
  },

  async findByIdForUser(id: string, userId: string): Promise<RunRow | null> {
    const { rows } = await pool.query<RunRow>(
      "SELECT * FROM runs WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async setStatus(id: string, status: string): Promise<void> {
    await pool.query(
      `UPDATE runs SET
         status = $2,
         started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
         ended_at = CASE WHEN $2 IN ('completed', 'failed') THEN COALESCE(ended_at, now()) ELSE ended_at END,
         updated_at = now()
       WHERE id = $1`,
      [id, status],
    );
  },

  async setTargetId(id: string, targetId: string): Promise<void> {
    await pool.query(
      "UPDATE runs SET target_id = $2, updated_at = now() WHERE id = $1",
      [id, targetId],
    );
  },

  async setPythonRunId(id: string, pythonRunId: string): Promise<void> {
    await pool.query(
      "UPDATE runs SET python_run_id = $2, updated_at = now() WHERE id = $1",
      [id, pythonRunId],
    );
  },

  async setError(id: string, error: string): Promise<void> {
    await pool.query(
      `UPDATE runs SET status = 'failed', error = $2,
         ended_at = COALESCE(ended_at, now()), updated_at = now()
       WHERE id = $1`,
      [id, error],
    );
  },
};
