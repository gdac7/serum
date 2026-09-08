"""Request/response schemas for the AutoDAN-Turbo approach.

Kept out of server/config.py so the shared schemas there stay free of any one
approach's vocabulary — phases, strategy libraries and HarmBench metrics are
AutoDAN's, not every approach's.
"""
from datetime import datetime

from pydantic import BaseModel, Field, model_validator
from typing import Any, Dict, List, Literal, Optional


AutoDANRunStatus = Literal[
    "queued", "warmup", "lifelong", "evaluating", "scoring", "completed", "failed"
]


class AutoDANRunRequest(BaseModel):
    client_id: str
    target_id: str
    phases: List[Literal["warmup", "lifelong", "evaluate"]] = Field(min_length=1)
    # The malicious requests to attack with. Supply them directly here, or name a
    # built-in dataset via `standard_dataset` and the service loads it instead.
    dataset: List[str] = Field(default_factory=list)
    standard_dataset: Optional[Literal["harmbench"]] = None
    standard_dataset_percent: Optional[int] = Field(default=None, ge=1, le=100)
    iteration_overrides: Optional[Dict[str, Any]] = None
    # Start the run with an empty in-memory library instead of the stored one.
    # Non-destructive: what is already stored stays, and this run's discoveries
    # are still written into the same client+target library.
    fresh_library: bool = False

    @model_validator(mode="after")
    def _check_dataset_source(self) -> "AutoDANRunRequest":
        if self.standard_dataset is not None:
            if self.standard_dataset_percent is None:
                raise ValueError("standard_dataset_percent is required with standard_dataset")
        elif not self.dataset:
            raise ValueError("provide 'dataset' or 'standard_dataset'")
        return self


class AutoDANRunCreateResponse(BaseModel):
    client_id: str
    run_id: str
    target_id: str
    status: AutoDANRunStatus


class AutoDANRunStatusResponse(BaseModel):
    client_id: str
    run_id: str
    target_id: str
    status: AutoDANRunStatus
    error: Optional[str] = None
    # Strategies discovered but not stored. A 'completed' run with a non-empty
    # list did real work that was partly lost.
    persist_errors: List[str] = []


class PhaseSummary(BaseModel):
    total_attacks: int
    successful_attacks: int
    strategies_discovered: int
    average_score: float
    phase_time_minutes: float
    strategy_names: List[str]


class Generation(BaseModel):
    malicious_request: str
    attack_prompt: str
    target_response: str
    # None in the evaluate phase, which HarmBench scores instead of the scorer model.
    score: Optional[float] = None


class HarmbenchMetrics(BaseModel):
    asr: float
    rsr: float
    n_behaviors: int
    n_attempts: int


class AutoDANRunResultsResponse(BaseModel):
    client_id: str
    run_id: str
    target_id: str
    status: AutoDANRunStatus
    phases: Dict[str, PhaseSummary]
    generations: Optional[Dict[str, List[Generation]]] = None
    metrics: Optional[HarmbenchMetrics] = None


class AutoDANMetricsResponse(BaseModel):
    client_id: str
    run_id: str
    target_id: str
    status: AutoDANRunStatus
    metrics: HarmbenchMetrics


class StrategySummary(BaseModel):
    """List view: everything except the large text blobs.

    The three omitted fields (example_prompt_pi/pj, response_i) are full
    attack prompts and full model responses, so including them would make
    listing a library orders of magnitude heavier than scanning it needs.
    Fetch GET /v1/strategies/{id} for those.
    """
    strategy_id: str
    name: str
    malicious_request: str = ""
    definition: str
    category: str
    mechanism: str
    key_difference: str
    success_rate: float
    average_score: float
    usage_count: int
    improvement: Optional[float] = None
    score_i: Optional[float] = None
    score_j: Optional[float] = None
    discovered_date: datetime
    source_attack_id: str
    parent_strategies: List[str]
    effective_against: List[str]
    has_embedding: bool


class StrategyResponse(BaseModel):
    strategy_id: str
    name: str
    malicious_request: str = ""
    definition: str
    category: str
    mechanism: str
    key_difference: str
    # The attack pair the strategy was distilled from: pi is the weaker
    # attempt, pj the stronger one that beat it.
    example_prompt_pi: str
    example_prompt_pj: str
    # The target response pi produced, i.e. the one the strategy overcame.
    # Its embedding is the retrieval key, so this is what the library is
    # keyed on -- not the malicious request and not the attack prompt.
    response_i: str
    # The target response pj produced, i.e. the improved answer the strategy achieved.
    response_j: str = ""
    success_rate: float
    average_score: float
    usage_count: int
    improvement: Optional[float] = None
    # The scorer's raw score for each attempt at discovery time, distinct from
    # average_score (a running mean across every merged rediscovery of pj-type
    # scores) and improvement (their delta).
    score_i: Optional[float] = None
    score_j: Optional[float] = None
    discovered_date: datetime
    source_attack_id: str
    parent_strategies: List[str]
    effective_against: List[str]
    # The 384-dim vector itself is not serialized, but whether it survived the
    # round trip is worth seeing: a strategy without one is never retrieved.
    has_embedding: bool


class StrategyListResponse(BaseModel):
    client_id: str
    # None when the library was addressed by library_id rather than by a
    # registered target.
    target_id: Optional[str] = None
    library_id: str
    # Rows in the library, before `name`/`limit` filtering.
    total: int
    returned: int
    strategies: List[StrategySummary]


class LibraryResponse(BaseModel):
    library_id: str
    # Derived from the target config, so it survives restarts and is the
    # stable way to recognise which target a library belongs to.
    target_key: str
    strategy_count: int
    created_at: datetime
    updated_at: datetime


class LibraryListResponse(BaseModel):
    client_id: str
    libraries: List[LibraryResponse]

