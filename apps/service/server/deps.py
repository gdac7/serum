"""Route dependencies and ownership lookups shared by every approach."""
from typing import Any, Dict
import uuid

from fastapi import HTTPException, Request

from server.db.run_repository import RunRepository
from server.db.target_repository import TargetRepository
from server.state import reattach_unloaded, state, targets


def get_owned_target_or_404(client_id: str, target_id: str) -> Dict[str, Any]:
    target = targets.get(target_id)
    if target is not None and target.get("client_id") == client_id:
        return target
    # Not in memory: fall back to the persisted registration and reattach it as
    # unloaded, so a target survives a restart without the client re-registering.
    with state.db_pool.connection() as conn:
        record = TargetRepository(conn).get(client_id, target_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"target '{target_id}' is not registered for client '{client_id}'",
        )
    return reattach_unloaded(record)


def get_owned_run_or_404(client_id: str, run_id: str) -> Dict[str, Any]:
    with state.db_pool.connection() as conn:
        record = RunRepository(conn).get_run(client_id, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"run '{run_id}' not found for this client")
    return record


def strict_query_params(*allowed: str):
    """Reject unknown query parameters instead of ignoring them.

    FastAPI drops query params a handler does not declare, so a misspelled or
    misplaced one (`?strategy_id=...` on the list route) silently returns the
    wrong thing. Declared as a route dependency, this turns that into a 422.
    """
    allowed_set = set(allowed)

    def _check(request: Request) -> None:
        unknown = sorted(set(request.query_params) - allowed_set)
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"unknown query parameter(s): {', '.join(unknown)}. "
                    f"This route accepts: {', '.join(sorted(allowed_set))}"
                ),
            )

    return _check


def parse_uuid_or_404(value: str, what: str) -> str:
    try:
        uuid.UUID(value)
    except ValueError:
        # A UUID column would make psycopg raise on the cast, surfacing an
        # input error as a 500.
        raise HTTPException(status_code=404, detail=f"{what} '{value}' not found")
    return value
