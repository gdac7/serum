import json
from typing import Any, Dict, List, Optional

import numpy as np
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

TERMINAL_STATUSES = ("completed", "failed")


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"{type(o).__name__} is not JSON serializable")


def _as_jsonb(value) -> Optional[Jsonb]:
    if value is None:
        return None
    return Jsonb(value, dumps=lambda o: json.dumps(o, default=_json_default))


def _from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "run_id": str(row["run_id"]),
        "client_id": row["client_id"],
        "target_id": str(row["target_id"]),
        "library_id": str(row["library_id"]) if row["library_id"] else None,
        "status": row["status"],
        "phases": list(row["phases"] or []),
        "error": row["error"],
        "persist_errors": list(row["persist_errors"] or []),
        "strategies_at_start": row["strategies_at_start"],
        "strategies_loaded": row["strategies_loaded"],
        "result": row["result"],
    }


class RunRepository:
    """All run-state SQL. Bound to one connection, i.e. one unit of work."""

    def __init__(self, conn):
        self.conn = conn

    def create_run(
        self,
        run_id: str,
        client_id: str,
        target_id: str,
        library_id: str,
        phases: List[str],
        status: str = "queued",
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO runs (run_id, client_id, target_id, library_id, phases, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (run_id, client_id, target_id, library_id, list(phases), status),
            )

    def get_run(self, client_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM runs WHERE run_id = %s AND client_id = %s",
                (run_id, client_id),
            )
            row = cur.fetchone()
            return _from_row(row) if row else None

    def set_status(self, run_id: str, status: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE runs SET status = %s, updated_at = now() WHERE run_id = %s",
                (status, run_id),
            )

    def set_progress(self, run_id: str, at_start: int, loaded: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs
                SET strategies_at_start = %s, strategies_loaded = %s, updated_at = now()
                WHERE run_id = %s
                """,
                (at_start, loaded, run_id),
            )

    def append_persist_error(self, run_id: str, message: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs
                SET persist_errors = array_append(persist_errors, %s), updated_at = now()
                WHERE run_id = %s
                """,
                (message, run_id),
            )

    def complete(self, run_id: str, result: Dict[str, Any]) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs
                SET status = 'completed', result = %s, updated_at = now()
                WHERE run_id = %s
                """,
                (_as_jsonb(result), run_id),
            )

    def fail(self, run_id: str, error: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE runs SET status = 'failed', error = %s, updated_at = now() WHERE run_id = %s",
                (error, run_id),
            )

    def fail_interrupted(self, error: str) -> int:
        """Reconcile runs left mid-flight by a crash: their background task is gone."""
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs SET status = 'failed', error = %s, updated_at = now()
                WHERE status <> ALL(%s)
                """,
                (error, list(TERMINAL_STATUSES)),
            )
            return cur.rowcount
