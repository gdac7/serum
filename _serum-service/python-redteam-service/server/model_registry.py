import threading
from typing import Dict, List

from src.local_models.transformers_models import LocalModelTransformers


class ModelRegistry:
    """Loads the fixed local models (shared/scorer) on demand and frees them on
    release. Client targets are not managed here."""

    def __init__(self, specs: Dict[str, str]):

        self._specs = specs
        self._loaded: Dict[str, LocalModelTransformers] = {}
        self._lock = threading.Lock()

    def get(self, name: str) -> LocalModelTransformers:
        if name not in self._specs:
            raise KeyError(f"unknown model role '{name}'")
        with self._lock:
            model = self._loaded.get(name)
            if model is None:
                print(f"[registry] loading '{name}' ({self._specs[name]})")
                model = LocalModelTransformers(model_name=self._specs[name], function=name)
                self._loaded[name] = model
            return model

    def release(self, *names: str) -> None:
        # Frees only if no other reference survives, so callers must drop theirs first.
        with self._lock:
            for name in names:
                model = self._loaded.pop(name, None)
                if model is None:
                    continue
                print(f"[registry] releasing '{name}'")
                model.unload()
                del model

    def release_all(self) -> None:
        self.release(*list(self._loaded))

    def loaded(self) -> List[str]:
        with self._lock:
            return sorted(self._loaded)
