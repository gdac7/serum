from pathlib import Path
from typing import Optional

import psycopg

from server.db.pool import resolve_conninfo

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def apply_schema(conninfo: Optional[str] = None) -> None:
    """Apply schema.sql. Run before starting the service for the first time."""
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with psycopg.connect(resolve_conninfo(conninfo), autocommit=True) as conn:
        conn.execute(sql)
    print(f"applied {SCHEMA_PATH}")


if __name__ == "__main__":
    apply_schema()
