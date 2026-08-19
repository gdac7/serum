from abc import ABC, abstractmethod
from transformers import AutoTokenizer, AutoModelForCausalLM

class LocalModel(ABC):
    def __init__(self, model_name: str):
        self.model_name = model_name
        self.message = None
        self.last_output = None

    @abstractmethod
    def generate(self, user_prompt: str, system_prompt: str, max_new_tokens, do_sample=True, temperature=0.7):
        raise NotImplementedError("Implement this for your own model")
    
    @abstractmethod
    def transformers_generate_directly(self):
        """
        Tranformers has a way to generate output directly.
        The output contains tokens like <sys>, </inst>, etc.
        Might be useful for debugging
        """
        pass
