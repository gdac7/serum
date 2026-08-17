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
  endpoint_url: string | null;
  api_key_env: string | null;
  encrypted_api_key: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NewRun {
  userId: string;
  modelName: string;
  phases: string[];
  dataset: string[];
  freshLibrary: boolean;
  load4Bits: boolean;
  targetKind: string;
  endpointUrl: string | null;
  apiKeyEnv: string | null;
  encryptedApiKey: string | null;
}

export const runRepository = {
  async create(run: NewRun): Promise<RunRow> {
    const { rows } = await pool.query<RunRow>(
      `INSERT INTO runs
         (user_id, model_name, phases, dataset, fresh_library, load_4_bits,
          target_kind, endpoint_url, api_key_env, encrypted_api_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        run.userId,
        run.modelName,
        run.phases,
        run.dataset,
        run.freshLibrary,
        run.load4Bits,
        run.targetKind,
        run.endpointUrl,
        run.apiKeyEnv,
        run.encryptedApiKey,
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

  async findByIdForUser(id: string, userId: string): Promise<RunRow | null> {
    const { rows } = await pool.query<RunRow>(
      "SELECT * FROM runs WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async setStatus(id: string, status: string): Promise<void> {
    await pool.query(
      "UPDATE runs SET status = $2, updated_at = now() WHERE id = $1",
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
      "UPDATE runs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1",
      [id, error],
    );
  },
};
