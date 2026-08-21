import ipaddress
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests

from src.core.apimodels_interface import ModelInterfaceAPI
from ..utils.dev import *

DEFAULT_PROMPT_FIELD = "input_text"
DEFAULT_RESPONSE_FIELD = "output"

RESPONSE_FALLBACK_FIELDS = ("output", "generated_text", "response", "text")


def _is_private_host(host: str) -> bool:
    host = (host or "").strip("[]").lower()
    if host in ("localhost", "") or host.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local


class RemoteModelAPI(ModelInterfaceAPI):
    def __init__(
        self,
        endpoint_url: str,
        model_name: str = "",
        api_key: Optional[str] = None,
        timeout: float = 300,
        prompt_field: Optional[str] = None,
        response_field: Optional[str] = None,
        **kwargs: Any,
    ):
        super().__init__(repo_name=endpoint_url, model_name=model_name, timeout=timeout, token=api_key)
        self.endpoint_url = endpoint_url
        self.prompt_field = prompt_field or DEFAULT_PROMPT_FIELD
        self.response_field = response_field or DEFAULT_RESPONSE_FIELD
        # Local dev endpoints are commonly self-signed; public hosts stay verified.
        self.verify_tls = not _is_private_host(urlparse(endpoint_url).hostname or "")

    def _extract(self, result: Any) -> str:
        if isinstance(result, str):
            return result
        if not isinstance(result, dict):
            raise ValueError(f"target endpoint returned {type(result).__name__}, expected a JSON object")
        for field in (self.response_field, *RESPONSE_FALLBACK_FIELDS):
            value = result.get(field)
            if isinstance(value, str):
                return value
        raise ValueError(
            f"target endpoint response has no '{self.response_field}' field; got keys {sorted(result)}"
        )

    def generate(self, user_prompt: str, system_prompt: str = None, max_tokens: int = MAX_TOKENS_EXP, temperature: float = TEMP_ZERO, **kwargs):
        payload: Dict[str, Any] = {self.prompt_field: user_prompt}
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else None
        try:
            response = requests.post(
                self.endpoint_url,
                json=payload,
                headers=headers,
                timeout=self.timeout,
                verify=self.verify_tls,
            )
            response.raise_for_status()
            return self._extract(response.json())
        except requests.exceptions.RequestException as e:
            print(f"API Error: {e}")
            raise e
