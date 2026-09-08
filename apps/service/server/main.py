"""Application entrypoint: the FastAPI app, its lifespan, and the routers.

Routes live in server/routers/ (shared across approaches) and in
server/approaches/<id>/router.py (one attack technique each). Adding an
approach is a new module plus one line in APPROACH_ROUTERS below.
"""
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from server.approaches.autodan.router import router as autodan_router
from server.db.pool import create_pool
from server.db.run_repository import RunRepository
from server.db.target_repository import TargetRepository
from server.model_registry import ModelRegistry
from server.routers.shared import router as shared_router
from server.state import reattach_unloaded, state, targets
from src.approaches.autodan.auto_dan_turbo import AutoDANTurbo

APPROACH_ROUTERS = [autodan_router]


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = AutoDANTurbo.load_config()
    state.config = config
    state.attacker_name = config["models"]["shared"]
    state.scorer_name = config["models"]["scorer"]
    state.summarizer_name = config["models"]["shared"]
    # Loaded on first use, so an idle service holds no weights.
    state.registry = ModelRegistry({
        "shared": config["models"]["shared"],
        "scorer": config["models"]["scorer"],
    })
    state.db_pool = create_pool()
    with state.db_pool.connection() as conn:
        interrupted = RunRepository(conn).fail_interrupted(
            "service restarted while run was in progress; resubmit the run"
        )
        for record in TargetRepository(conn).list_all():
            reattach_unloaded(record)
    if interrupted:
        print(f"marked {interrupted} interrupted run(s) as failed")
    if targets:
        print(f"reattached {len(targets)} registered target(s) as unloaded")
    yield
    state.registry.release_all()
    state.db_pool.close()


app = FastAPI(title="serum-redteam-service", lifespan=lifespan)

app.include_router(shared_router)
for approach_router in APPROACH_ROUTERS:
    app.include_router(approach_router)


if __name__ == "__main__":
    uvicorn.run(app)
