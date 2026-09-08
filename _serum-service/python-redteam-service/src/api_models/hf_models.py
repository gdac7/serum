from core.apimodels_interface import ModelInterfaceAPI
from huggingface_hub import InferenceClient
import os
from typing import List, Dict, Optional

class ModelHFAPI(ModelInterfaceAPI):
    def __init__(self, repo_name, model_name, timeout, token):
        super().__init__(repo_name=repo_name, model_name=model_name, timeout=timeout, token=token)
        self.client = InferenceClient(
            model=self.repo_name,
            api_key=self.token,
        )
        self.last_response = None

    def get_message(self, user_prompt: str, system_prompt: Optional[str] = None) -> List[Dict]: 
        if not user_prompt:
            raise ValueError("user_prompt must have a valid value")
        messages = []
        if system_prompt is not None:
            system_dict = {"role": "system", "content": f"{system_prompt}"}
            messages.append(system_dict)
        user_dict = {"role": "user", "content": user_prompt}
        messages.append(user_dict)
        self.last_messages = messages
        print(self.last_messages)
        return self.last_messages
    
    def generate(self, user_prompt: str, system_prompt: Optional[str] = None, max_tokens = 1000, temperature = 0.7) -> str:
        self.last_response = self.client.chat_completion(
            messages=self.get_message(user_prompt, system_prompt),
            max_tokens=max_tokens,
            temperature=temperature
        )
        return self.last_response.choices[0].message.content
    