import requests
from typing import Dict, Any, Optional
from src.core.apimodels_interface import ModelInterfaceAPI
from ..utils.dev import *

class RemoteModelAPI(ModelInterfaceAPI):
    def __init__(self, endpoint_url: str, model_name: str = "", api_key: Optional[str] = None, timeout: float = 300, **kwargs: Any):
        super().__init__(repo_name=endpoint_url, model_name=model_name, timeout=timeout, token=api_key)
        self.endpoint_url = endpoint_url

    def generate(self, user_prompt: str, system_prompt: str = None, max_tokens: int = MAX_TOKENS_EXP, temperature: float = TEMP_ZERO, **kwargs):
        payload : Dict[str, Any] = {
            "user_prompt": user_prompt,
            "system_prompt": system_prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "function": kwargs.get("function", "not defined")
        }
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else None
        try:
            response = requests.post(self.endpoint_url, json=payload, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            result = response.json()
            return result['generated_text']
        except requests.exceptions.RequestException as e:
            print(f"API Error: {e}")
            raise e
    
