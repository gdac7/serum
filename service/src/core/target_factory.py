import os
from typing import Any, Dict, Union

from .apimodels_interface import ModelInterfaceAPI
from .local_models_interface import LocalModel
from ..local_models.transformers_models import LocalModelTransformers
from ..api_models.remote_model import RemoteModelAPI


def build_target_model(target_cfg: Dict[str, Any]) -> Union[ModelInterfaceAPI, LocalModel]:
    """
    Builds the target model to attack, from a per-request config supplied by
    the client:

      kind: local -> loaded in-process here, any HF repo id
        model_name: "org/model"

      kind: api -> the client's own hosted model, reached over HTTP
        endpoint_url: "https://..."
        model_name: "..."            (optional, for logging)
        api_key_env: "TARGET_API_KEY" (optional, env var holding the secret)
    """
    kind = target_cfg.get("kind", "local")

    if kind == "local":
        return LocalModelTransformers(
            model_name=target_cfg["model_name"],
            load_4_bits=target_cfg.get("load_4_bits", False),
        )

    if kind == "api":
        api_key = os.environ.get(target_cfg["api_key_env"]) if target_cfg.get("api_key_env") else None
        return RemoteModelAPI(
            endpoint_url=target_cfg["endpoint_url"],
            model_name=target_cfg.get("model_name", ""),
            api_key=api_key,
            timeout=target_cfg.get("timeout", 300),
        )

    raise ValueError(f"Unknown target kind '{kind}'. Expected 'local' or 'api'.")
