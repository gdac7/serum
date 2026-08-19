import { pool } from "../infra/db/pool";

export interface TargetRow {
  id: string;
  user_id: string;
  kind: string;
  model_name: string;
  endpoint_url: string | null;
  encrypted_api_key: string | null;
  load_4_bits: boolean;
  python_target_id: string | null;
  status: string;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NewTarget {
  userId: string;
  kind: string;
  modelName: string;
  endpointUrl: string | null;
  encryptedApiKey: string | null;
  load4Bits: boolean;
}

export const targetRepository = {
  async create(t: NewTarget): Promise<TargetRow> {
    const { rows } = await pool.query<TargetRow>(
      `INSERT INTO targets
         (user_id, kind, model_name, endpoint_url, encrypted_api_key, load_4_bits)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        t.userId,
        t.kind,
        t.modelName,
        t.endpointUrl,
        t.encryptedApiKey,
        t.load4Bits,
      ],
    );
    return rows[0];
  },

  async listByUser(userId: string): Promise<TargetRow[]> {
    const { rows } = await pool.query<TargetRow>(
      "SELECT * FROM targets WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows;
  },

  async findByIdForUser(id: string, userId: string): Promise<TargetRow | null> {
    const { rows } = await pool.query<TargetRow>(
      "SELECT * FROM targets WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async setPythonTargetId(id: string, pythonTargetId: string): Promise<void> {
    await pool.query(
      "UPDATE targets SET python_target_id = $2, updated_at = now() WHERE id = $1",
      [id, pythonTargetId],
    );
  },

  async setStatus(id: string, status: string, error: string | null = null): Promise<void> {
    await pool.query(
      "UPDATE targets SET status = $2, error = $3, updated_at = now() WHERE id = $1",
      [id, status, error],
    );
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      "DELETE FROM targets WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },
};
