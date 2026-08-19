import { pool } from "../infra/db/pool";

export interface ConnectorRow {
  id: string;
  user_id: string;
  target_id: string;
  token_hash: string;
  last_seen_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export const connectorRepository = {
  async create(userId: string, targetId: string, tokenHash: string): Promise<ConnectorRow> {
    const { rows } = await pool.query<ConnectorRow>(
      `INSERT INTO connectors (user_id, target_id, token_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, targetId, tokenHash],
    );
    return rows[0];
  },

  async findByTokenHash(tokenHash: string): Promise<ConnectorRow | null> {
    const { rows } = await pool.query<ConnectorRow>(
      "SELECT * FROM connectors WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  async findActiveForTarget(targetId: string): Promise<ConnectorRow | null> {
    const { rows } = await pool.query<ConnectorRow>(
      "SELECT * FROM connectors WHERE target_id = $1 AND revoked_at IS NULL",
      [targetId],
    );
    return rows[0] ?? null;
  },

  async revokeForTarget(targetId: string): Promise<void> {
    await pool.query(
      "UPDATE connectors SET revoked_at = now() WHERE target_id = $1 AND revoked_at IS NULL",
      [targetId],
    );
  },

  async touch(id: string): Promise<void> {
    await pool.query("UPDATE connectors SET last_seen_at = now() WHERE id = $1", [id]);
  },
};
