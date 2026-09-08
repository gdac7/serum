from datetime import datetime

from pydantic import BaseModel, Field
from typing import List, Literal, Optional


# "unloaded": registration known from PostgreSQL, weights not resident (e.g.
# after a restart). Rebuilt on demand from the stored config.
TargetStatus = Literal["unloaded", "queued", "loading", "loaded", "failed"]


class TargetConfig(BaseModel):
    kind: Literal["local", "api"]
    model_name: str
    endpoint_url: Optional[str] = None
    # The caller (Node) forwards the decrypted key directly; never persisted
    # here, only held in memory for the target's lifetime.
    api_key: Optional[str] = None
    # Legacy fallback: name of an env var on this host holding the key.
    api_key_env: Optional[str] = None
    # Override the default "input_text" in / "output" out contract.
    prompt_field: Optional[str] = None
    response_field: Optional[str] = None
    load_4_bits: bool = False


class CreateUserRequest(BaseModel):
    client_id: str


class CreateUserResponse(BaseModel):
    client_id: str
    # False when the client already owns strategy libraries. This service has
    # no concept of a client beyond the libraries it owns, so a client with
    # none is indistinguishable from an unknown one -- by design, since client
    # identity belongs to the caller.
    created: bool
    libraries: int


class TargetConfigRequest(BaseModel):
    client_id: str
    target: TargetConfig


class TargetCreateResponse(BaseModel):
    client_id: str
    target_id: str
    status: TargetStatus


class TargetHealthResponse(BaseModel):
    client_id: str
    target_id: str
    status: TargetStatus
    model_name: Optional[str] = None
    error: Optional[str] = None


class TargetSummary(BaseModel):
    target_id: str
    client_id: str
    kind: str
    model_name: str
    endpoint_url: Optional[str] = None
    load_4_bits: bool
    status: TargetStatus
    created_at: datetime


class TargetListResponse(BaseModel):
    client_id: str
    targets: List[TargetSummary]


class ChatRequest(BaseModel):
    client_id: str
    message: str = Field(min_length=1)
    system_prompt: Optional[str] = None
    max_tokens: int = Field(default=512, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)



class DbHealthResponse(BaseModel):
    pgvector_version: Optional[str] = None
    libraries: int
    strategies: int
    runs: int


class HealthResponse(BaseModel):
    attacker_name: str
    summarizer_name: str
    scorer_name: str
    loaded_models: List[str]
