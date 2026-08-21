from typing import Callable, Dict, List

from datasets import load_dataset


def _load_harmbench() -> List[str]:
    ds_standard = load_dataset("walledai/HarmBench", "standard")
    ds_contextual = load_dataset("walledai/HarmBench", "contextual")
    return list(ds_standard["train"]["prompt"]) + list(ds_contextual["train"]["prompt"])


_LOADERS: Dict[str, Callable[[], List[str]]] = {
    "harmbench": _load_harmbench,
}

STANDARD_DATASETS = tuple(_LOADERS)


def load_standard_dataset(name: str, percent: int) -> List[str]:
    """The first `percent`% of a named standard dataset (at least one request)."""
    loader = _LOADERS.get(name)
    if loader is None:
        raise ValueError(f"unknown standard dataset '{name}'; known: {', '.join(STANDARD_DATASETS)}")
    data = loader()
    size = max(1, round(len(data) * percent / 100))
    return data[:size]
