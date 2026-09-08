from src.core.apimodels_interface import ModelInterfaceAPI
import google.generativeai as genai
from typing import Optional

class GoogleModelAPI(ModelInterfaceAPI):
    def __init__(self, repo_name, model_name, timeout, token):
        super().__init__(repo_name, model_name, timeout, token)
        self.model_client = None
        genai.configure(api_key=token)

    def set_model_client(self, system_prompt: str = None):
        self.model_client = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=system_prompt if system_prompt is not None else None,
        )
    
    def generate(self, user_prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1000, temperature: float = 0.7):
        config = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        self.set_model_client(system_prompt)
    
        response = self.model_client.generate_content(
            contents=user_prompt,
            generation_config=config
        )
        self.last_response = response
        return response.text
        