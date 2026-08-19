from abc import ABC, abstractmethod


class ModelInterfaceAPI(ABC):
    """
    Abstract interface for different LLM providers
    """
    def __init__(self, repo_name: str, model_name: str, timeout: float, token: str):
        self.repo_name = repo_name
        self.timeout = timeout
        self.token = token
        self.model_name = model_name

    @abstractmethod
    def generate(self, user_prompt: str, system_prompt: str, max_tokens: int = 1000, temperature: float = 0.7) -> str:
        raise NotImplementedError("Implement this for your specific LLM provider")
    
