import uuid
from typing import Any, Dict, Union

from server.config import TargetConfig

# Fixed namespace so a target's id is reproducible across processes and
# deployments. Changing it orphans every existing target id.
TARGET_NAMESPACE = uuid.UUID("6f1c3d2e-8a4b-5c7d-9e0f-1a2b3c4d5e6f")


def derive_target_key(target: Union[TargetConfig, Dict[str, Any]]) -> str:
    """Stable identity for a target across runs, used to scope its strategy library.

    Quantization (`load_4_bits`) is deliberately excluded: it is a deployment
    detail, not a different set of guardrails to learn against.
    """
    cfg = target.model_dump() if isinstance(target, TargetConfig) else dict(target)
    kind = (cfg.get("kind") or "").strip().lower()
    model_name = (cfg.get("model_name") or "").strip().lower()

    if kind == "api":
        endpoint = (cfg.get("endpoint_url") or "").strip().lower().rstrip("/")
        return f"api:{endpoint}|{model_name}"
    return f"local:{model_name}"


def derive_target_id(client_id: str, target: Union[TargetConfig, Dict[str, Any]]) -> str:
    """Deterministic target id, so the same config always yields the same handle.

    A uuid4 here would be regenerated on every registration, leaving the
    strategy library reachable only through a handle that dies with the
    process. uuid5 makes the id a function of the config instead, so
    re-registering after a restart returns the caller's original id.

    Scoped by client on purpose: deriving from the config alone would make two
    clients registering the same `endpoint_url` collide on one cached model,
    and an `api` target carries the credential to reach it.
    """
    return str(uuid.uuid5(TARGET_NAMESPACE, f"{client_id}|{derive_target_key(target)}"))
