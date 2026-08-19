import os
from typing import Optional

from pgvector.psycopg import register_vector
from psycopg_pool import ConnectionPool


def _configure(conn) -> None:
    register_vector(conn)


def resolve_conninfo(conninfo: Optional[str] = None) -> str:
    conninfo = conninfo or os.environ.get("DATABASE_URL")
    if not conninfo:
        raise RuntimeError("DATABASE_URL is not set")
    return conninfo


def create_pool(conninfo: Optional[str] = None, min_size: int = 1, max_size: int = 4) -> ConnectionPool:
    """Open a connection pool with the pgvector type adapter registered per connection."""
    pool = ConnectionPool(
        resolve_conninfo(conninfo),
        min_size=min_size,
        max_size=max_size,
        configure=_configure,
        open=False,
    )
    try:
        pool.open(wait=True, timeout=15)
    except Exception as e:
        pool.close()
        raise RuntimeError(
            f"could not open a PostgreSQL pool ({type(e).__name__}: {e}). "
            "Check DATABASE_URL, that the server is reachable, and that "
            "`python -m server.db.migrate` has been applied."
        ) from e
    return pool
