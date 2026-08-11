import os
import threading

# Reduces allocator fragmentation, which otherwise can fail a large contiguous
# allocation right after a release.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException, Query, Request
from typing import Any, Dict, List, Optional
import uuid
import uvicorn
from contextlib import asynccontextmanager
import pynvml
from server.config import (
    CreateUserRequest, CreateUserResponse,
    TargetConfigRequest, TargetCreateResponse, TargetHealthResponse,
    AutoDANRunRequest, AutoDANRunCreateResponse, AutoDANRunStatusResponse,
    AutoDANRunResultsResponse, AutoDANMetricsResponse,
    StrategyResponse, StrategySummary, StrategyListResponse, LibraryListResponse,
    DbHealthResponse, HealthResponse,
)
from src.core.target_factory import build_target_model
from src.core.auto_dan_turbo import AutoDANTurbo
from src.harmbench_eval.get_harmbench_values import get_results, release_classifier
from server.db.pool import create_pool
from server.db.strategy_repository import StrategyRepository
from server.db.run_repository import RunRepository
from server.model_registry import ModelRegistry
from server.target_key import derive_target_id, derive_target_key

# Targets stay in memory: the model instance is a live GPU handle that cannot
# be persisted, so a restart drops them and the client re-POSTs to rebuild.
targets: Dict[str, dict] = {}

# One GPU, one run at a time: concurrent runs would release each other's models.
gpu_lock = threading.Lock()


def _get_owned_target_or_404(client_id: str, target_id: str) -> Dict[str, Any]:
    target = targets.get(target_id)
    if target is None or target.get("client_id") != client_id:
        raise HTTPException(
            status_code=404,
            detail=(
                f"target '{target_id}' is not registered for client '{client_id}'. "
                "Target models live in GPU memory and do not survive a restart: "
                "POST /v1/targets with the same config to rebuild it. The id is "
                "derived from the config, so you get the same target_id back."
            ),
        )
    return target


def _get_owned_run_or_404(client_id: str, run_id: str) -> Dict[str, Any]:
    with app.state.db_pool.connection() as conn:
        record = RunRepository(conn).get_run(client_id, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"run '{run_id}' not found for this client")
    return record


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = AutoDANTurbo.load_config()
    app.state.config = config
    app.state.attacker_name = config["models"]["shared"]
    app.state.scorer_name = config["models"]["scorer"]
    app.state.summarizer_name = config["models"]["shared"]
    # Loaded on first use, so an idle service holds no weights.
    app.state.registry = ModelRegistry({
        "shared": config["models"]["shared"],
        "scorer": config["models"]["scorer"],
    })
    app.state.db_pool = create_pool()
    with app.state.db_pool.connection() as conn:
        interrupted = RunRepository(conn).fail_interrupted(
            "service restarted while run was in progress; resubmit the run"
        )
    if interrupted:
        print(f"marked {interrupted} interrupted run(s) as failed")
    yield
    app.state.registry.release_all()
    app.state.db_pool.close()


app = FastAPI(title="autodan-turbo-service", lifespan=lifespan)


def _make_strategy_sink(run_id: str, library_id: str):
    """Persist each validated strategy on its own short-lived connection.

    A failed write is recorded on the run before being re-raised: the phase
    survives it, but the run must never look clean while dropping strategies.
    """
    pool = app.state.db_pool

    def sink(strategy) -> None:
        try:
            with pool.connection() as conn:
                StrategyRepository(conn).save_strategy(library_id, strategy)
        except Exception as e:
            with pool.connection() as conn:
                RunRepository(conn).append_persist_error(
                    run_id, f"{strategy.name}: {type(e).__name__}: {e}"
                )
            raise

    return sink


def _set_status(run_id: str, status: str) -> None:
    with app.state.db_pool.connection() as conn:
        RunRepository(conn).set_status(run_id, status)


def run_autodan_task(run_id: str, target_id: str, dataset: List[str], phases: List[str], iteration_overrides: Dict[str, Any], library_id: str, fresh_library: bool = False):
    with gpu_lock:
        registry = app.state.registry
        autodan = shared_model = None
        try:
            target_info = targets.get(target_id)
            if not target_info or target_info.get("status") != "loaded":
                raise ValueError(f"target '{target_id}' does not exist or is not ready")

            shared_model = registry.get("shared")
            autodan = AutoDANTurbo(
                attacker_model=shared_model,
                summarizer_model=shared_model,
                scorer_model=registry.get("scorer"),
                target_model=target_info["model_instance"],
                config=app.state.config,
                on_strategy_discovered=_make_strategy_sink(run_id, library_id),
            )

            with app.state.db_pool.connection() as conn:
                repo = StrategyRepository(conn)
                at_start = repo.count_strategies(library_id)
                loaded = 0 if fresh_library else repo.hydrate(library_id, autodan.strategy_library)
                RunRepository(conn).set_progress(run_id, at_start, loaded)

            overrides = dict(iteration_overrides or {})
            num_steps = overrides.pop("num_steps", 4)
            save_dir = f"{run_id}/results"

            phase_summaries: Dict[str, Any] = {}
            generations = None
            for phase in phases:
                if phase == "warmup":
                    _set_status(run_id, "warmup")
                    phase_summaries[phase] = autodan.warmup_exploration(
                        malicious_request=dataset,
                        save_dir=save_dir,
                        **overrides,
                    )
                elif phase == "lifelong":
                    _set_status(run_id, "lifelong")
                    phase_summaries[phase] = autodan.lifelong_learning(
                        malicious_request=dataset,
                        save_dir=save_dir,
                        **overrides,
                    )
                elif phase == "evaluate":
                    _set_status(run_id, "evaluating")
                    generations = autodan.evaluate(
                        behavior=dataset,
                        num_steps=num_steps,
                        save_dir=save_dir,
                    )

            # Free attacker/scorer before the HarmBench classifier loads, so the two
            # never occupy the GPU at the same time.
            autodan = shared_model = None
            registry.release("shared", "scorer")

            metrics = None
            if generations is not None:
                _set_status(run_id, "scoring")
                try:
                    metrics = get_results(
                        generations, f"{save_dir}/harmbench_metrics.json"
                    )
                finally:
                    release_classifier()

            with app.state.db_pool.connection() as conn:
                RunRepository(conn).complete(run_id, {
                    "phases": phase_summaries,
                    "generations": generations,
                    "metrics": metrics,
                })
        except Exception as e:
            with app.state.db_pool.connection() as conn:
                RunRepository(conn).fail(run_id, f"{type(e).__name__}: {e}")
        finally:
            # Rebind before releasing: a live local reference keeps the weights allocated.
            autodan = shared_model = None
            registry.release("shared", "scorer")


def load_target(target_id: str, target_cfg: Dict[str, Any]):
    targets[target_id]["status"] = "loading"
    try:
        targets[target_id]["model_name"] = target_cfg.get("model_name", "default")
        targets[target_id]["model_instance"] = build_target_model(target_cfg)
        targets[target_id]["status"] = "loaded"
    except Exception as e:
        targets[target_id]["status"] = "failed"
        targets[target_id]["error"] = f"{type(e).__name__}: {e}"


# 200, not 201: this provisions nothing durable, so claiming Created would be
# a lie for a client that already owns libraries.
@app.post("/v1/create_client", response_model=CreateUserResponse, status_code=200)
def create_client(request: CreateUserRequest):
    """Optional: any endpoint provisions the client on first use.

    `created` is answered from PostgreSQL, not the in-memory dict. The dict is
    empty after a restart, so it would report a client with an established
    strategy library as brand new -- and a caller using that to check whether
    an id was free could hand one tenant another tenant's library.
    """
    with app.state.db_pool.connection() as conn:
        libraries = StrategyRepository(conn).list_libraries(request.client_id)
    return {
        "client_id": request.client_id,
        "created": len(libraries) == 0,
        "libraries": len(libraries),
    }


@app.post("/v1/targets", response_model=TargetCreateResponse, status_code=201)
async def create_target(request: TargetConfigRequest, background_tasks: BackgroundTasks):
    # Same client + same config always resolves to the same handle, so this
    # call re-attaches instead of building a second copy of loaded weights.
    target_id = derive_target_id(request.client_id, request.target)
    existing = targets.get(target_id)
    if existing is None or existing.get("status") == "failed":
        targets[target_id] = {
            "status": "queued",
            "client_id": request.client_id,
            "target_key": derive_target_key(request.target),
        }
        background_tasks.add_task(
            load_target,
            target_id=target_id,
            target_cfg=request.target.model_dump(),
        )
    return {"client_id": request.client_id, "target_id": target_id, "status": targets[target_id]["status"]}


# Plain `def`: psycopg is synchronous, so FastAPI runs this in the threadpool
# rather than blocking the event loop on the library lookup below.
@app.post("/v1/runs", response_model=AutoDANRunCreateResponse, status_code=201)
def create_autodan_run(request: AutoDANRunRequest, background_tasks: BackgroundTasks):
    target = _get_owned_target_or_404(request.client_id, request.target_id)
    run_id = str(uuid.uuid4())

    with app.state.db_pool.connection() as conn:
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
        dataset=request.dataset,
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


@app.get("/v1/runs/{run_id}", response_model=AutoDANRunStatusResponse)
async def get_run_status(run_id: str, client_id: str):
    record = _get_owned_run_or_404(client_id, run_id)
    return {
        "client_id": client_id,
        "run_id": run_id,
        "target_id": record["target_id"],
        "status": record["status"],
        "error": record.get("error"),
        "persist_errors": record.get("persist_errors", []),
    }


@app.get("/v1/runs/{run_id}/progress")
def get_run_progress(run_id: str, client_id: str):
    """Live view of this run's strategy library, readable while the run is going.

    The library spans runs, so `total` includes strategies inherited from
    earlier ones; `discovered_this_run` is the delta since this run started.
    """
    record = _get_owned_run_or_404(client_id, run_id)
    with app.state.db_pool.connection() as conn:
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
        "strategies": [strategy.to_dict() for strategy in strategies],
    }


def _get_completed_run_or_409(client_id: str, run_id: str) -> Dict[str, Any]:
    record = _get_owned_run_or_404(client_id, run_id)
    if record["status"] != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"run '{run_id}' status is '{record['status']}', results not available yet",
        )
    return record


@app.get("/v1/runs/{run_id}/results", response_model=AutoDANRunResultsResponse)
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


@app.get("/v1/runs/{run_id}/metrics", response_model=AutoDANMetricsResponse)
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


def _parse_uuid_or_404(value: str, what: str) -> str:
    try:
        uuid.UUID(value)
    except ValueError:
        # A UUID column would make psycopg raise on the cast, surfacing an
        # input error as a 500.
        raise HTTPException(status_code=404, detail=f"{what} '{value}' not found")
    return value


@app.get(
    "/v1/libraries",
    response_model=LibraryListResponse,
    dependencies=[Depends(strict_query_params("client_id"))],
)
def list_libraries(client_id: str):
    """Every strategy library this client owns, keyed by target_key.

    Readable with no in-memory state: after a restart the targets dict is
    empty, but the libraries are in PostgreSQL and this is how you find them.
    """
    with app.state.db_pool.connection() as conn:
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
                f"pass 'library_id' to pick one. See GET /v1/libraries: {options}"
            ),
        )
    return libraries[0]["library_id"]


@app.get(
    "/v1/strategies",
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
    GET /v1/libraries, the restart-proof route since it needs no loaded target
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

    with app.state.db_pool.connection() as conn:
        repo = StrategyRepository(conn)
        if library_id is not None:
            _parse_uuid_or_404(library_id, "library")
            if not repo.owns_library(client_id, library_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"library '{library_id}' not found for client '{client_id}'",
                )
        elif target_id is not None:
            target = _get_owned_target_or_404(client_id, target_id)
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


@app.get(
    "/v1/strategies/{strategy_id}",
    response_model=StrategyResponse,
    dependencies=[Depends(strict_query_params("client_id"))],
)
def get_strategy(strategy_id: str, client_id: str):
    _parse_uuid_or_404(strategy_id, "strategy")
    with app.state.db_pool.connection() as conn:
        strategy = StrategyRepository(conn).get_strategy_for_client(client_id, strategy_id)
    if strategy is None:
        raise HTTPException(status_code=404, detail=f"strategy '{strategy_id}' not found")
    return _to_strategy_response(strategy)


@app.get("/v1/target_health/{target_id}", response_model=TargetHealthResponse)
async def get_target_status(target_id: str, client_id: str):
    record = _get_owned_target_or_404(client_id, target_id)
    return {
        "client_id": client_id,
        "target_id": target_id,
        "status": record["status"],
        "model_name": record.get("model_name"),
        "error": record.get("error"),
    }


@app.get("/v1/health", response_model=HealthResponse)
async def get_health():
    return {
        "attacker_name": app.state.attacker_name,
        "summarizer_name": app.state.summarizer_name,
        "scorer_name": app.state.scorer_name,
        "loaded_models": app.state.registry.loaded(),
    }


# Plain `def`, not `async def`: psycopg is synchronous, so FastAPI must run this
# in the threadpool instead of blocking the event loop.
@app.get("/v1/db_health", response_model=DbHealthResponse)
def get_db_health():
    with app.state.db_pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            row = cur.fetchone()
            cur.execute("SELECT count(*) FROM strategy_libraries")
            libraries = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM strategies")
            strategies = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM runs")
            runs = cur.fetchone()[0]
    return {
        "pgvector_version": row[0] if row else None,
        "libraries": libraries,
        "strategies": strategies,
        "runs": runs,
    }


@app.get("/v1/vram_usage", response_model=Dict[str, float])
async def get_vram_usage():
    pynvml.nvmlInit()
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        total = info.total / (1024 ** 2)
        used = info.used / (1024 ** 2)
        free = info.free / (1024 ** 2)
    finally:
        pynvml.nvmlShutdown()
    return {
        "total_mb": round(total, 2),
        "used_mb": round(used, 2),
        "free_mb": round(free, 2),
        "used_percent": round((used / total) * 100, 2),
    }


if __name__ == "__main__":
    uvicorn.run(app)
