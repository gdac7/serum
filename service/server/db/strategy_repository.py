from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from psycopg.rows import dict_row

from src.core.data_structures import JailbreakStrategy, StrategyLibrary

EMBEDDING_DIM = 384

_STRATEGY_FIELDS = (
    "strategy_id",
    "library_id",
    "name",
    "definition",
    "example_prompt_pi",
    "example_prompt_pj",
    "response_solved",
    "category",
    "mechanism",
    "key_difference",
    "success_rate",
    "average_score",
    "usage_count",
    "improvement",
    "discovered_date",
    "source_attack_id",
    "parent_strategies",
    "effective_against",
    "context_embedding",
)

_INSERT_STRATEGY = """
INSERT INTO strategies ({columns})
VALUES ({placeholders})
ON CONFLICT (strategy_id) DO UPDATE SET
    success_rate = EXCLUDED.success_rate,
    average_score = EXCLUDED.average_score,
    usage_count = EXCLUDED.usage_count,
    improvement = EXCLUDED.improvement,
    effective_against = EXCLUDED.effective_against
""".format(
    columns=", ".join(_STRATEGY_FIELDS),
    placeholders=", ".join(f"%({field})s" for field in _STRATEGY_FIELDS),
)


def _as_vector(embedding) -> Optional[np.ndarray]:
    if embedding is None:
        return None
    vector = np.asarray(embedding, dtype=np.float32)
    if vector.shape != (EMBEDDING_DIM,):
        raise ValueError(
            f"embedding has shape {vector.shape}, expected ({EMBEDDING_DIM},)"
        )
    return vector


def _default_if_none(value, default):
    """Coerce None on a NOT NULL column.

    A column DEFAULT only applies when the column is omitted from the INSERT;
    naming every column, as we do, sends an explicit NULL instead and the
    insert fails. Dropping the strategy would be the worse outcome.
    """
    return default if value is None else value


def _to_params(library_id: str, strategy: JailbreakStrategy) -> Dict[str, Any]:
    return {
        "strategy_id": strategy.strategy_id,
        "library_id": library_id,
        "name": strategy.name,
        "definition": strategy.definition,
        "example_prompt_pi": strategy.example_prompt_pi,
        "example_prompt_pj": strategy.example_prompt_pj,
        "response_solved": strategy.response_solved,
        "category": strategy.category,
        "mechanism": strategy.mechanism,
        "key_difference": strategy.key_difference,
        "success_rate": _default_if_none(strategy.success_rate, 0.0),
        "average_score": _default_if_none(strategy.average_score, 0.0),
        "usage_count": _default_if_none(strategy.usage_count, 0),
        "improvement": strategy.improvement,
        "discovered_date": strategy.discovered_date,
        "source_attack_id": strategy.source_attack_id,
        "parent_strategies": list(strategy.parent_strategies or []),
        "effective_against": list(strategy.effective_against or []),
        "context_embedding": _as_vector(strategy.context_embedding),
    }


def _from_row(row: Dict[str, Any]) -> JailbreakStrategy:
    return JailbreakStrategy(
        strategy_id=str(row["strategy_id"]),
        name=row["name"],
        definition=row["definition"] or "",
        example_prompt_pi=row["example_prompt_pi"] or "",
        example_prompt_pj=row["example_prompt_pj"] or "",
        response_solved=row["response_solved"] or "",
        category=row["category"] or "",
        mechanism=row["mechanism"] or "",
        key_difference=row["key_difference"] or "",
        success_rate=row["success_rate"],
        average_score=row["average_score"],
        usage_count=row["usage_count"],
        discovered_date=row["discovered_date"],
        source_attack_id=row["source_attack_id"] or "",
        parent_strategies=list(row["parent_strategies"] or []),
        effective_against=list(row["effective_against"] or []),
        context_embedding=_as_vector(row["context_embedding"]),
        improvement=row["improvement"],
    )


class StrategyRepository:
    """All strategy-library SQL. Bound to one connection, i.e. one unit of work.

    Construct inside a `with pool.connection() as conn:` block; every call made
    on the instance commits or rolls back together with that block.
    """

    def __init__(self, conn):
        self.conn = conn

    def get_or_create_library(self, client_id: str, target_key: str) -> str:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO strategy_libraries (client_id, target_key)
                VALUES (%s, %s)
                ON CONFLICT (client_id, target_key)
                DO UPDATE SET updated_at = now()
                RETURNING library_id
                """,
                (client_id, target_key),
            )
            return str(cur.fetchone()[0])

    def find_library(self, client_id: str, target_key: str) -> Optional[str]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT library_id FROM strategy_libraries WHERE client_id = %s AND target_key = %s",
                (client_id, target_key),
            )
            row = cur.fetchone()
            return str(row[0]) if row else None

    def list_libraries(self, client_id: str) -> List[Dict[str, Any]]:
        """Every library a client owns, with its strategy count.

        LEFT JOIN so a library that exists but holds nothing still appears;
        an INNER JOIN would hide exactly the empty libraries worth noticing.
        """
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT l.library_id, l.target_key, l.created_at, l.updated_at,
                       count(s.strategy_id) AS strategy_count
                FROM strategy_libraries l
                LEFT JOIN strategies s USING (library_id)
                WHERE l.client_id = %s
                GROUP BY l.library_id
                ORDER BY l.updated_at DESC
                """,
                (client_id,),
            )
            return [
                {
                    "library_id": str(row["library_id"]),
                    "target_key": row["target_key"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "strategy_count": int(row["strategy_count"]),
                }
                for row in cur
            ]

    def owns_library(self, client_id: str, library_id: str) -> bool:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM strategy_libraries WHERE library_id = %s AND client_id = %s",
                (library_id, client_id),
            )
            return cur.fetchone() is not None

    def save_strategy(self, library_id: str, strategy: JailbreakStrategy) -> None:
        with self.conn.cursor() as cur:
            cur.execute(_INSERT_STRATEGY, _to_params(library_id, strategy))

    def save_strategies(self, library_id: str, strategies: List[JailbreakStrategy]) -> int:
        if not strategies:
            return 0
        with self.conn.cursor() as cur:
            cur.executemany(
                _INSERT_STRATEGY,
                [_to_params(library_id, strategy) for strategy in strategies],
            )
        return len(strategies)

    def load_strategies(
        self,
        library_id: str,
        name: Optional[str] = None,
        limit: Optional[int] = None,
        newest_first: bool = False,
    ) -> List[JailbreakStrategy]:
        """Every strategy in a library, oldest first unless asked otherwise.

        Defaults are deliberately unfiltered and unlimited so `hydrate` gets
        the whole library; the filters exist for the inspection endpoints.
        """
        # Interpolated from a fixed pair of literals, never from user input.
        direction = "DESC" if newest_first else "ASC"
        sql = f"""
            SELECT * FROM strategies
            WHERE library_id = %(library_id)s
              AND (%(name)s::text IS NULL OR lower(name) = lower(%(name)s))
            ORDER BY discovered_date {direction}
            LIMIT %(limit)s
        """
        params = {"library_id": library_id, "name": name, "limit": limit}
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            return [_from_row(row) for row in cur]

    def get_strategy_for_client(
        self, client_id: str, strategy_id: str
    ) -> Optional[JailbreakStrategy]:
        """Fetch one strategy, scoping ownership in the query itself.

        The join is the access control: a strategy_id belonging to another
        client's library simply produces no row, so there is no window where
        the row is loaded and then checked.
        """
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT s.* FROM strategies s
                JOIN strategy_libraries l USING (library_id)
                WHERE l.client_id = %s AND s.strategy_id = %s
                """,
                (client_id, strategy_id),
            )
            row = cur.fetchone()
            return _from_row(row) if row else None

    def hydrate(self, library_id: str, library: StrategyLibrary) -> int:
        """Load every stored strategy into `library`, keeping its embedding index in sync."""
        strategies = self.load_strategies(library_id)
        for strategy in strategies:
            library.add_strategy(strategy)
        return len(strategies)

    def search_similar(
        self,
        library_id: str,
        embedding,
        top_k: int = 5,
        min_similarity: float = 0.3,
    ) -> List[Tuple[JailbreakStrategy, float]]:
        """Cosine-similarity search scoped to one library.

        `<=>` is cosine distance, so similarity is `1 - distance`.
        """
        params = {
            "library_id": library_id,
            "embedding": _as_vector(embedding),
            "min_similarity": float(min_similarity),
            "top_k": int(top_k),
        }
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT *, 1 - (context_embedding <=> %(embedding)s) AS similarity
                FROM strategies
                WHERE library_id = %(library_id)s
                  AND context_embedding IS NOT NULL
                  AND 1 - (context_embedding <=> %(embedding)s) >= %(min_similarity)s
                ORDER BY context_embedding <=> %(embedding)s
                LIMIT %(top_k)s
                """,
                params,
            )
            return [(_from_row(row), float(row["similarity"])) for row in cur]

    def count_strategies(self, library_id: str) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM strategies WHERE library_id = %s", (library_id,)
            )
            return int(cur.fetchone()[0])

    def clear_library(self, library_id: str) -> int:
        """Drop every strategy in a library, keeping the library row itself."""
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM strategies WHERE library_id = %s", (library_id,))
            return cur.rowcount
