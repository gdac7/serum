"""Routes every approach shares: clients, targets, chat and health.

A target is an input to any approach, not a property of one, so none of this
lives under an approach prefix.
"""
import json
import time
from typing import Any, Dict, Iterator, List

import pynvml
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse

from server.approaches.autodan.strategy_repository import StrategyRepository
from server.config import (
    ChatRequest,
    CreateUserRequest, CreateUserResponse,
    DbHealthResponse, HealthResponse,
    TargetConfigRequest, TargetCreateResponse, TargetHealthResponse,
    TargetListResponse,
)
from server.db.target_repository import TargetRepository
from server.deps import get_owned_target_or_404, strict_query_params
from server.state import gpu_lock, load_target, state, targets
from server.target_key import derive_target_id, derive_target_key
from src.interfaces.local_models_interface import LocalModel

router = APIRouter()


# 200, not 201: this provisions nothing durable, so claiming Created would be
# a lie for a client that already owns libraries.
@router.post("/v1/create_client", response_model=CreateUserResponse, status_code=200)
def create_client(request: CreateUserRequest):
    """Optional: any endpoint provisions the client on first use.

    `created` is answered from PostgreSQL, not the in-memory dict. The dict is
    empty after a restart, so it would report a client with an established
    strategy library as brand new -- and a caller using that to check whether
    an id was free could hand one tenant another tenant's library.
    """
    with state.db_pool.connection() as conn:
        libraries = StrategyRepository(conn).list_libraries(request.client_id)
    return {
        "client_id": request.client_id,
        "created": len(libraries) == 0,
        "libraries": len(libraries),
    }


@router.post("/v1/targets", response_model=TargetCreateResponse, status_code=201)
async def create_target(request: TargetConfigRequest, background_tasks: BackgroundTasks):
    # Same client + same config always resolves to the same handle, so this
    # call re-attaches instead of building a second copy of loaded weights.
    target_id = derive_target_id(request.client_id, request.target)
    target_key = derive_target_key(request.target)
    config = request.target.model_dump()

    with state.db_pool.connection() as conn:
        TargetRepository(conn).upsert(target_id, request.client_id, target_key, config)

    existing = targets.get(target_id)
    if existing is None or existing.get("status") in ("failed", "unloaded"):
        targets[target_id] = {
            "status": "queued",
            "client_id": request.client_id,
            "target_key": target_key,
            "config": config,
            "model_name": config.get("model_name"),
        }
        background_tasks.add_task(load_target, target_id=target_id)
    return {"client_id": request.client_id, "target_id": target_id, "status": targets[target_id]["status"]}


def _sse(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _chunk_text(text: str) -> Iterator[str]:
    """Split a full reply into word-sized deltas for the typing effect.

    Used for targets that return their whole reply at once (kind:"api"), where
    there is no real token stream to forward.
    """
    for i, word in enumerate(text.split(" ")):
        yield word if i == 0 else " " + word


def _stream_target_reply(target: Dict[str, Any], request: ChatRequest) -> Iterator[str]:
    """Yield SSE frames for one chat turn against a loaded target.

    Local targets stream real tokens under `gpu_lock` (the same lock runs hold,
    so a chat never races a run for the single GPU). Remote targets have no
    streaming contract, so their reply is fetched whole and chunked.
    """
    model = target["model_instance"]
    is_local = isinstance(model, LocalModel)
    lock_acquired = False
    try:
        if is_local:
            lock_acquired = gpu_lock.acquire(blocking=False)
            if not lock_acquired:
                # Not necessarily *this* target's run: attacker, scorer and
                # summarizer are local, so any run saturates the one GPU.
                yield _sse({"type": "error", "error": "the GPU is busy with a run; local models are unavailable until it finishes"})
                return
            deltas = model.stream_generate(
                request.message, request.system_prompt,
                max_tokens=request.max_tokens, temperature=request.temperature,
            )
        else:
            reply = model.generate(
                request.message, request.system_prompt,
                max_tokens=request.max_tokens, temperature=request.temperature,
            )
            deltas = _chunk_text(reply)

        parts: List[str] = []
        for delta in deltas:
            parts.append(delta)
            yield _sse({"type": "token", "text": delta})
            if not is_local:
                time.sleep(0.02)
        yield _sse({"type": "done", "text": "".join(parts)})
    except Exception as e:
        yield _sse({"type": "error", "error": f"{type(e).__name__}: {e}"})
    finally:
        if lock_acquired:
            gpu_lock.release()


@router.post("/v1/targets/{target_id}/chat")
async def chat_with_target(target_id: str, request: ChatRequest, background_tasks: BackgroundTasks):
    """Stream a single chat turn from a target as Server-Sent Events.

    Emits `token` frames as text arrives, a final `done` frame with the full
    reply, or an `error` frame. Stateless: pass any prior context in
    `system_prompt` (multi-turn history is out of scope for now).
    """
    target = get_owned_target_or_404(request.client_id, target_id)
    if target.get("status") == "unloaded":
        background_tasks.add_task(load_target, target_id=target_id)
        raise HTTPException(
            status_code=409,
            detail=f"target '{target_id}' is rebuilding after a restart; retry shortly",
        )
    if target.get("status") != "loaded":
        raise HTTPException(
            status_code=409,
            detail=f"target '{target_id}' is '{target.get('status')}', not ready to chat",
        )
    return StreamingResponse(
        _stream_target_reply(target, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# Plain `def`: psycopg is synchronous, so FastAPI runs this in the threadpool


@router.get(
    "/v1/targets",
    response_model=TargetListResponse,
    dependencies=[Depends(strict_query_params("client_id"))],
)
def list_targets(client_id: str):
    """Every target this client has registered, restart-proof from PostgreSQL."""
    with state.db_pool.connection() as conn:
        records = TargetRepository(conn).list_for_client(client_id)
    summaries = []
    for record in records:
        entry = targets.get(record["target_id"])
        cfg = record["config"]
        summaries.append({
            "target_id": record["target_id"],
            "client_id": record["client_id"],
            "kind": cfg["kind"],
            "model_name": cfg["model_name"],
            "endpoint_url": cfg.get("endpoint_url"),
            "load_4_bits": cfg.get("load_4_bits", False),
            "status": entry.get("status") if entry else "unloaded",
            "created_at": record["created_at"],
        })
    return {"client_id": client_id, "targets": summaries}


@router.get("/v1/target_health/{target_id}", response_model=TargetHealthResponse)
async def get_target_status(target_id: str, client_id: str):
    record = get_owned_target_or_404(client_id, target_id)
    return {
        "client_id": client_id,
        "target_id": target_id,
        "status": record["status"],
        "model_name": record.get("model_name"),
        "error": record.get("error"),
    }


@router.delete("/v1/targets/{target_id}", status_code=204)
async def delete_target(target_id: str, client_id: str):
    """Evict a target: unload its GPU weights (if loaded locally), drop the
    in-memory entry, and remove the persisted registration.

    Does not touch the strategy library -- that's keyed by target_key, not
    target_id, so it outlives the target and is reused if the same config is
    ever re-registered.
    """
    get_owned_target_or_404(client_id, target_id)
    entry = targets.get(target_id)

    if entry is not None and isinstance(entry.get("model_instance"), LocalModel):
        if not gpu_lock.acquire(blocking=False):
            raise HTTPException(
                status_code=409,
                detail=f"target '{target_id}' is busy with a run; retry shortly",
            )
        try:
            entry["model_instance"].unload()
        finally:
            gpu_lock.release()

    targets.pop(target_id, None)
    with state.db_pool.connection() as conn:
        TargetRepository(conn).delete(client_id, target_id)


@router.get("/v1/health", response_model=HealthResponse)
async def get_health():
    return {
        "attacker_name": state.attacker_name,
        "summarizer_name": state.summarizer_name,
        "scorer_name": state.scorer_name,
        "loaded_models": state.registry.loaded(),
    }


# Plain `def`, not `async def`: psycopg is synchronous, so FastAPI must run this
# in the threadpool instead of blocking the event loop.
@router.get("/v1/db_health", response_model=DbHealthResponse)
def get_db_health():
    with state.db_pool.connection() as conn:
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


@router.get("/v1/vram_usage", response_model=Dict[str, float])
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
