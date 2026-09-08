"""The AutoDAN-Turbo approach: runs, strategy libraries and their results.

Mounted at /v1/autodan. Everything specific to the algorithm's vocabulary --
phases, strategy libraries, HarmBench metrics -- lives behind this prefix, so
a second approach is a sibling module rather than an edit to these routes.
"""
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from server.approaches.autodan.schemas import (
    AutoDANMetricsResponse,
    AutoDANRunCreateResponse, AutoDANRunRequest, AutoDANRunResultsResponse,
    AutoDANRunStatusResponse,
    LibraryListResponse,
    StrategyListResponse, StrategyResponse, StrategySummary,
)
from server.approaches.autodan.strategy_repository import StrategyRepository
from server.approaches.autodan.task import run_autodan_task
from server.db.run_repository import RunRepository
from server.deps import (
    get_owned_run_or_404, get_owned_target_or_404,
    parse_uuid_or_404, strict_query_params,
)
from server.standard_datasets import load_standard_dataset
from server.state import state

router = APIRouter(prefix="/v1/autodan")


# Plain `def`: psycopg is synchronous, so FastAPI runs this in the threadpool
# rather than blocking the event loop on the library lookup below.
@router.post("/runs", response_model=AutoDANRunCreateResponse, status_code=201)
def create_autodan_run(request: AutoDANRunRequest, background_tasks: BackgroundTasks):
    target = get_owned_target_or_404(request.client_id, request.target_id)
    run_id = str(uuid.uuid4())

    if request.standard_dataset is not None:
        try:
            dataset = load_standard_dataset(request.standard_dataset, request.standard_dataset_percent)
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"failed to load standard dataset '{request.standard_dataset}': {type(e).__name__}: {e}",
            )
    else:
        dataset = request.dataset

    with state.db_pool.connection() as conn:
        repo = StrategyRepository(conn)
        library_id = repo.get_or_create_library(request.client_id, target["target_key"])
        stored_strategies = repo.count_strategies(library_id)

        # `evaluate` only consumes the library; warmup/lifelong are what produce
        # it. Without either, an empty library means evaluating against nothing.
        if not any(phase in ("warmup", "lifelong") for phase in request.phases):
            if request.fresh_library:
                raise HTTPException(
                    status_code=409,
                    detail="'fresh_library' with no 'warmup' or 'lifelong' phase would evaluate against an empty strategy library",
                )
            if stored_strategies == 0:
                raise HTTPException(
                    status_code=409,
                    detail="no stored strategy library for this client and target: run 'warmup' and/or 'lifelong' first",
                )

        RunRepository(conn).create_run(
            run_id, request.client_id, request.target_id, library_id, request.phases
        )

    background_tasks.add_task(
        run_autodan_task,
        run_id=run_id,
        target_id=request.target_id,
        dataset=dataset,
        phases=request.phases,
        iteration_overrides=request.iteration_overrides,
        library_id=library_id,
        fresh_library=request.fresh_library,
    )
    return {
        "client_id": request.client_id,
        "run_id": run_id,
        "target_id": request.target_id,
        "status": "queued",
    }


@router.get("/runs/{run_id}", response_model=AutoDANRunStatusResponse)
async def get_run_status(run_id: str, client_id: str):
    record = get_owned_run_or_404(client_id, run_id)
    return {
        "client_id": client_id,
        "run_id": run_id,
        "target_id": record["target_id"],
        "status": record["status"],
        "error": record.get("error"),
        "persist_errors": record.get("persist_errors", []),
    }


@router.get("/runs/{run_id}/progress")
def get_run_progress(run_id: str, client_id: str):
    """Live view of this run's strategy library, readable while the run is going.

    The library spans runs, so `total` includes strategies inherited from
    earlier ones; `discovered_this_run` is the delta since this run started.
    """
    record = get_owned_run_or_404(client_id, run_id)
    with state.db_pool.connection() as conn:
        strategies = StrategyRepository(conn).load_strategies(record["library_id"])
    at_start = record.get("strategies_at_start")
    return {
        "run_id": run_id,
        "status": record["status"],
        "total": len(strategies),
        "loaded_from_library": record.get("strategies_loaded"),
        "discovered_this_run": None if at_start is None else len(strategies) - at_start,
        # Strategies the run found but failed to store. Non-empty means the
        # counts above understate what the phases actually discovered.
        "persist_errors": record.get("persist_errors", []),
        # One entry per malicious request already finished, in completion order.
        "request_scores": record.get("request_scores", []),
        "strategies": [strategy.to_dict() for strategy in strategies],
    }


def _get_completed_run_or_409(client_id: str, run_id: str) -> Dict[str, Any]:
    record = get_owned_run_or_404(client_id, run_id)
    if record["status"] != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"run '{run_id}' status is '{record['status']}', results not available yet",
        )
    return record


@router.get("/runs/{run_id}/results", response_model=AutoDANRunResultsResponse)
async def get_run_results(run_id: str, client_id: str):
    record = _get_completed_run_or_409(client_id, run_id)
    result = record["result"]
    return {
        "client_id": client_id,
        "run_id": run_id,
        "target_id": record["target_id"],
        "status": record["status"],
        "phases": result["phases"],
        "generations": result["generations"],
        "metrics": result["metrics"],
    }


@router.get("/runs/{run_id}/prompts")
async def get_run_prompts(run_id: str, client_id: str):
    """Every attack prompt/response generated during training (warmup/lifelong).

    Grouped by phase; each entry is a full attack log (request, prompt,
    response, score). Evaluate-phase generations aren't training and are
    served by /results instead. Runs completed before this was added report
    empty groups.
    """
    record = _get_completed_run_or_409(client_id, run_id)
    result = record["result"] or {}
    return {
        "client_id": client_id,
        "run_id": run_id,
        "target_id": record["target_id"],
        "status": record["status"],
        "prompts": result.get("attack_logs", {}),
    }


@router.get("/runs/{run_id}/metrics", response_model=AutoDANMetricsResponse)
async def get_run_metrics(run_id: str, client_id: str):
    """HarmBench ASR/RSR. Only present when the run included the evaluate phase."""
    record = _get_completed_run_or_409(client_id, run_id)
    metrics = record["result"]["metrics"]
    if metrics is None:
        raise HTTPException(
            status_code=404,
            detail=f"run '{run_id}' has no metrics: it did not include the evaluate phase",
        )
    return {
        "client_id": client_id,
        "run_id": run_id,
        "target_id": record["target_id"],
        "status": record["status"],
        "metrics": metrics,
    }


def _to_strategy_response(strategy) -> Dict[str, Any]:
    """Full strategy payload.

    The list endpoint returns this too, but declares StrategySummary as its
    response_model, so FastAPI drops the large text fields on the way out.
    """
    payload = strategy.to_dict()
    payload["has_embedding"] = strategy.context_embedding is not None
    return payload


@router.get(
    "/libraries",
    response_model=LibraryListResponse,
    dependencies=[Depends(strict_query_params("client_id"))],
)
def list_libraries(client_id: str):
    """Every strategy library this client owns, keyed by target_key.

    Readable with no in-memory state: after a restart the targets dict is
    empty, but the libraries are in PostgreSQL and this is how you find them.
    """
    with state.db_pool.connection() as conn:
        libraries = StrategyRepository(conn).list_libraries(client_id)
    return {"client_id": client_id, "libraries": libraries}


def _sole_library_or_error(repo: StrategyRepository, client_id: str) -> str:
    """Resolve a library when the caller gave no handle at all.

    Unambiguous only when the client owns exactly one; with several, guessing
    would silently answer about the wrong target, so list them and let the
    caller choose.
    """
    libraries = repo.list_libraries(client_id)
    if not libraries:
        raise HTTPException(
            status_code=404,
            detail=(
                f"client '{client_id}' has no strategy library yet. "
                "Run 'warmup' and/or 'lifelong' first."
            ),
        )
    if len(libraries) > 1:
        options = ", ".join(f"{lib['library_id']} ({lib['target_key']})" for lib in libraries)
        raise HTTPException(
            status_code=409,
            detail=(
                f"client '{client_id}' owns {len(libraries)} libraries; "
                f"pass 'library_id' to pick one. See GET /v1/autodan/libraries: {options}"
            ),
        )
    return libraries[0]["library_id"]


@router.get(
    "/strategies",
    response_model=StrategyListResponse,
    dependencies=[
        Depends(
            strict_query_params(
                "client_id", "target_id", "library_id", "name", "limit", "newest_first"
            )
        )
    ],
)
def list_strategies(
    client_id: str,
    target_id: Optional[str] = None,
    library_id: Optional[str] = None,
    name: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    newest_first: bool = True,
):
    """Inspect a strategy library.

    Addressable three ways, in order of precision: `library_id` (from
    GET /v1/autodan/libraries, the restart-proof route since it needs no loaded target
    model), `target_id` (a registered target), or neither, which resolves to
    the client's library when it owns exactly one.

    Scoped by target rather than by run: the library outlives any single run,
    so a run id would be the wrong handle for it.
    """
    if target_id is not None and library_id is not None:
        raise HTTPException(
            status_code=422,
            detail="pass 'target_id' or 'library_id', not both",
        )

    with state.db_pool.connection() as conn:
        repo = StrategyRepository(conn)
        if library_id is not None:
            parse_uuid_or_404(library_id, "library")
            if not repo.owns_library(client_id, library_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"library '{library_id}' not found for client '{client_id}'",
                )
        elif target_id is not None:
            target = get_owned_target_or_404(client_id, target_id)
            library_id = repo.find_library(client_id, target["target_key"])
            if library_id is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"no strategy library for target '{target_id}': it has no completed runs yet",
                )
        else:
            library_id = _sole_library_or_error(repo, client_id)
        total = repo.count_strategies(library_id)
        strategies = repo.load_strategies(
            library_id, name=name, limit=limit, newest_first=newest_first
        )
    return {
        "client_id": client_id,
        "target_id": target_id,
        "library_id": library_id,
        "total": total,
        "returned": len(strategies),
        "strategies": [_to_strategy_response(s) for s in strategies],
    }


@router.get(
    "/strategies/{strategy_id}",
    response_model=StrategyResponse,
    dependencies=[Depends(strict_query_params("client_id"))],
)
def get_strategy(strategy_id: str, client_id: str):
    parse_uuid_or_404(strategy_id, "strategy")
    with state.db_pool.connection() as conn:
        strategy = StrategyRepository(conn).get_strategy_for_client(client_id, strategy_id)
    if strategy is None:
        raise HTTPException(status_code=404, detail=f"strategy '{strategy_id}' not found")
    return _to_strategy_response(strategy)
