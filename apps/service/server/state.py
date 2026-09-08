"""Process-wide runtime state, shared by every approach.

Lives outside main.py so routers can reach the pool, the model registry and
the target table without importing the FastAPI app (which imports them).
`state` is populated once by main.py's lifespan.
"""
from types import SimpleNamespace
from typing import Any, Dict
import threading

from src.interfaces.target_factory import build_target_model

# Set up by the lifespan in server/main.py: config, attacker_name, scorer_name,
# summarizer_name, registry, db_pool.
state = SimpleNamespace()

# In-memory view of registered targets. The registration (config) is persisted
# in PostgreSQL and rehydrated on startup as "unloaded"; only "model_instance",
# the live GPU handle, is ephemeral and rebuilt on demand from "config".
targets: Dict[str, dict] = {}

# One GPU, one run at a time: concurrent runs would release each other's models.
gpu_lock = threading.Lock()


def reattach_unloaded(record: Dict[str, Any]) -> Dict[str, Any]:
    """Put a persisted registration back in the dict without loading weights.

    An entry already in memory wins: it may hold live weights this must not
    drop back to "unloaded".
    """
    entry = targets.get(record["target_id"])
    if entry is None:
        entry = {
            "status": "unloaded",
            "client_id": record["client_id"],
            "target_key": record["target_key"],
            "config": record["config"],
            "model_name": record["config"].get("model_name"),
        }
        targets[record["target_id"]] = entry
    return entry


def build_target(target_id: str) -> None:
    """Build the GPU handle from the entry's stored config. Raises on failure."""
    entry = targets[target_id]
    entry["status"] = "loading"
    entry.pop("error", None)
    try:
        cfg = entry["config"]
        entry["model_name"] = cfg.get("model_name", "default")
        entry["model_instance"] = build_target_model(cfg)
        entry["status"] = "loaded"
    except Exception as e:
        entry["status"] = "failed"
        entry["error"] = f"{type(e).__name__}: {e}"
        raise


def load_target(target_id: str):
    try:
        if targets[target_id]["config"].get("kind") == "local":
            # Loading local weights competes for the same GPU used by runs and
            # chats. Queue behind them instead of allocating concurrently and
            # risking an out-of-memory failure or disturbing the active model.
            with gpu_lock:
                build_target(target_id)
        else:
            build_target(target_id)
    except Exception:
        pass
