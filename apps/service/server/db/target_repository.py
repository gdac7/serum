from typing import Any, Dict, List, Optional

from psycopg.rows import dict_row


def _from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "target_id": str(row["target_id"]),
        "client_id": row["client_id"],
        "target_key": row["target_key"],
        "config": {
            "kind": row["kind"],
            "model_name": row["model_name"],
            "endpoint_url": row["endpoint_url"],
            "api_key_env": row["api_key_env"],
            "load_4_bits": row["load_4_bits"],
        },
        "created_at": row["created_at"],
    }


class TargetRepository:
    """All target-registration SQL. Bound to one connection."""

    def __init__(self, conn):
        self.conn = conn

    def upsert(self, target_id: str, client_id: str, target_key: str, config: Dict[str, Any]) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO targets
                    (target_id, client_id, target_key, kind, model_name,
                     endpoint_url, api_key_env, load_4_bits)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (target_id) DO UPDATE SET
                    endpoint_url = EXCLUDED.endpoint_url,
                    api_key_env = EXCLUDED.api_key_env,
                    load_4_bits = EXCLUDED.load_4_bits,
                    updated_at = now()
                """,
                (
                    target_id, client_id, target_key,
                    config.get("kind"), config.get("model_name"),
                    config.get("endpoint_url"), config.get("api_key_env"),
                    bool(config.get("load_4_bits", False)),
                ),
            )

    def get(self, client_id: str, target_id: str) -> Optional[Dict[str, Any]]:
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM targets WHERE target_id = %s AND client_id = %s",
                (target_id, client_id),
            )
            row = cur.fetchone()
            return _from_row(row) if row else None

    def list_for_client(self, client_id: str) -> List[Dict[str, Any]]:
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM targets WHERE client_id = %s ORDER BY created_at",
                (client_id,),
            )
            return [_from_row(row) for row in cur.fetchall()]

    def list_all(self) -> List[Dict[str, Any]]:
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT * FROM targets")
            return [_from_row(row) for row in cur.fetchall()]

    def delete(self, client_id: str, target_id: str) -> bool:
        with self.conn.cursor() as cur:
            cur.execute(
                "DELETE FROM targets WHERE target_id = %s AND client_id = %s",
                (target_id, client_id),
            )
            return cur.rowcount > 0
