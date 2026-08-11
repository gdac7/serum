# LLM Vulnerability Testing Platform — Architecture Document

## Overview

A platform for testing LLMs against adversarial attack scenarios, enabling users to identify weaknesses in their model guardrails. Users configure a target LLM, select attack scenarios, and receive a structured vulnerability report with severity scoring and evidence.

---

## Software architecture patterns

This system uses different patterns per layer. There is no single pattern covering the whole application — that is intentional and normal for a decoupled SPA + API + async pipeline architecture.

### Node.js — Layered Architecture (N-Tier)

The API gateway follows a strict layered architecture where each layer only communicates with the one directly below it:

```
Route / Controller layer   → receives HTTP requests, validates input, returns responses
Service layer              → business logic (RunService, AuthService, DatasetService)
Repository layer           → all database access (PostgreSQL queries, no raw SQL in services)
Infrastructure layer       → Redis client, SSE emitter, Python service HTTP client
```

This keeps business logic testable and independent of transport or persistence concerns.

### React frontend — Feature-based structure

The frontend is organized by feature, not by technical type. Each feature owns its components, hooks, and API calls:

```
/features
  /auth         → login, register, password reset
  /chat         → chat page components and session state
  /runs         → test config page, live progress feed, run history
  /results      → results page, report export
/shared         → reusable components, hooks, API client, types
```

This avoids the flat `/components` + `/hooks` + `/pages` structure that breaks down as the app grows.

### Async run pipeline — Event-driven

The test run lifecycle (enqueue → Python → SSE → client) is event-driven, not request/response. BullMQ jobs carry the run configuration, Python emits granular events, and Node.js forwards them to the client over SSE. This part of the system does not fit a layered model and is intentionally treated separately.

### Python service — owns the strategy library

Unlike a stateless "distillation from a Node-supplied history" design, this
service **generates and owns its attack knowledge itself**. AutoDAN-Turbo's
warm-up and lifelong-learning phases discover jailbreak strategies as a
side effect of running attacks, and later phases (including `evaluate`) read
back from that same accumulated library. Node.js never hydrates a run
payload with historical attacks — it only supplies target config, dataset,
and which phase(s) to run. The library is **per-client, per-target**: each
client/target pair accumulates its own strategy library over time, not one
global library shared across all clients. (Letting a client instead *supply*
an existing strategy library up front is a real future feature, but out of
scope for now.)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React.js |
| API Gateway | Node.js (Express) |
| Job Queue | BullMQ + Redis |
| Red-team service | Python (existing) |
| Database | PostgreSQL |
| Prompt log store | PostgreSQL (separate table) or S3-compatible store |
| Real-time transport | Server-Sent Events (SSE) |

---

## Architecture Layers

### 1. React frontend

- Communicates exclusively with the Node.js gateway — never directly with the Python service.
- Uses `EventSource` (SSE) to receive live progress events during a test run.
- Displays per-scenario results as they arrive (pass / fail / severity) rather than waiting for the full run to complete.
- Never receives or stores the user's target LLM API key — only sends it once to Node.js at run creation time.

### 2. Node.js API gateway

Serves as the single public-facing entry point. Responsibilities:

- **Auth & authorization** — JWT validation on every request. Users only access their own runs.
- **Input validation** — sanitize and validate all payloads before forwarding.
- **Run manager** — owns the `TestRun` state machine (`queued → running → completed → failed`). Persists state to PostgreSQL.
- **Payload hydration** — for the `direct` method, Node.js fetches relevant historical attacks from PostgreSQL and includes them in the job payload. Python stays stateless and never queries the database directly.
- **Job enqueueing** — enqueues jobs to BullMQ/Redis and immediately returns `202 Accepted` with a `run_id`. The HTTP request cycle does not wait for the red-team run to complete.
- **SSE streamer** — holds open SSE connections per `run_id` and forwards progress events from Python to the client.
- **Response shaping** — transforms Python API responses into clean, frontend-friendly payloads. React has no knowledge of ML internals.
- **Secret handling** — target LLM API keys are encrypted at rest. Passed to Python inside the job payload over the internal network only. Never logged or returned to the client.

### 3. Redis (BullMQ job queue)

- Decouples Node.js from Python — no direct synchronous calls between them during a run.
- Provides retry with exponential backoff on Python service failures.
- Enforces a global concurrency cap on active runs to protect platform infrastructure (Python service, PostgreSQL) — not for cost control, since users provide their own API keys.
- Allows clients to disconnect and reconnect without losing run progress — state is always recoverable from PostgreSQL.

### 4. Python red-team service

A single service, single method (AutoDAN-Turbo). Stateless with respect to
Node.js's world (no auth, no run ownership, no calling Node's database) —
but **stateful with respect to its own strategy library**, which it owns,
persists, and evolves per client/target (see below).

**Authentication is entirely Node.js's job.** This service implements no
login, no tokens, no user records. Node validates the JWT, resolves the user
to a `client_id`, and forwards that `client_id` in the payload; Python trusts
it as already-authenticated and uses it only for **ownership** checks — one
client can never touch another's runs or strategy library. The guarantee that
nobody forges a `client_id` is the network boundary (Python is internal-only),
not a credential check in Python.

#### Routes

```
POST /v1/runs           — start an AutoDAN-Turbo run (warmup / lifelong / evaluate)
GET  /v1/runs/:id        — poll run status and partial results
GET  /v1/runs/:id/results — fetch full results on completion
```

`GET /v1/scenarios` doesn't apply here — there's one method, and "what to
attack" is the client-supplied dataset, not a fixed scenario catalog.

#### Internal modules

- **Attack pipeline** — `AutoDANTurbo` (warmup/lifelong/evaluate phases), `AttackGenerator`, `StrategyDiscoverer`, `StrategyValidator`.
- **Provider adapters** — `target_factory.build_target_model`: `LocalModelTransformers` (in-process HF models) or `RemoteModelAPI` (client's own hosted endpoint). Adding a new target kind doesn't change core attack logic.
- **Strategy library** — `StrategyLibrary` + `EmbeddingManager`: stores discovered jailbreak strategies and attack logs, retrieves similar strategies by embedding similarity. Persisted per client/target in PostgreSQL, embeddings in a `pgvector` column (`server/db/`). The run pipeline still writes to local disk until slice 2 wires it up — see NEXT_STEPS.md.
- **Results classifier** — the scorer model assigns a score (and explanation) per attack attempt.

#### Versioning

- All routes are versioned (`/v1/...`). The Python service includes the running model/method version in every response, forwarded by Node.js to logs and the client.

---

## Red-team method: AutoDAN-Turbo

There is one method, implemented by `AutoDANTurbo` (`src/core/auto_dan_turbo.py`).
It runs as up to three phases against a target model:

- **Warm-up exploration** — discovers initial jailbreak strategies from
  scratch against a dataset of malicious requests, with no prior strategy
  library.
- **Lifelong learning** — keeps attacking with a growing strategy library,
  discovering and validating new strategies as it goes.
- **Evaluate** — runs a fixed number of steps per behavior using the
  strategy library as-is (no new strategies discovered), producing the
  generations used for scoring/reporting.

**Characteristics:**
- Long-running (many iterations per request) — well suited to the async job
  queue pattern.
- Strategy library state (discovered strategies, attack logs, embeddings)
  persists **per client + per target** across requests — this service reads
  and writes it, Node.js never sees or hydrates it.
- Progress events are emitted per iteration/phase, analogous to `round_result`
  in a generic iterative-refinement design: e.g. `attack_completed`,
  `strategy_discovered`, `phase_completed`, `run_completed`.

**Job payload (shape, not final schema — see NEXT_STEPS.md):**
```json
{
  "run_id": "uuid",
  "client_id": "uuid",
  "target": {
    "kind": "local | api",
    "model_name": "...",
    "endpoint_url": "... (kind: api only)",
    "api_key_env": "... (kind: api only)"
  },
  "phases": ["warmup", "lifelong", "evaluate"],
  "dataset": ["malicious request 1", "..."],
  "iteration_overrides": {}
}
```

---

## TestRun state machine

```
queued → running → completed
                 ↘ failed
```

- State is owned and persisted by Node.js in PostgreSQL.
- Python reports progress via event callbacks; Node.js updates state accordingly.
- On Python service crash or timeout, BullMQ retries the job. Node.js resets state to `queued`.

---

## Real-time communication (SSE)

SSE is used instead of WebSockets because communication is unidirectional (server → client only). `EventSource` in React handles reconnection automatically.

**Event types emitted during a run:**

| Event | Description |
|---|---|
| `phase_started` | A phase (warmup / lifelong / evaluate) has begun |
| `attack_completed` | One attack iteration finished — includes score |
| `strategy_discovered` | A new jailbreak strategy was validated and added to the library |
| `phase_completed` | A phase finished, with its summary results |
| `run_completed` | All requested phases done, full results available |
| `run_failed` | Unrecoverable error |

---

## Observability

- **Trace IDs** — a `request_id` is generated in Node.js and forwarded to Python in every job payload. Logged at every layer.
- **Structured logging** — JSON logs throughout (Pino in Node.js, structlog in Python).
- **LLM-specific metrics** — tracked per run: `latency`, `token_count`, `model_version`, `method`, `scenario_category`, `pass_rate`.
- **Prompt & response logging** — full adversarial prompt and target response stored in the prompt log store for auditing and future distillation. Access-controlled separately from general app data.

---

## Security considerations

- The Python service is **not publicly exposed** — only Node.js faces the internet. Python is internal-network only. This is load-bearing, not defense in depth: since all auth terminates in Node and Python trusts the `client_id` it receives, anyone who can reach Python directly can impersonate any client. Public ingress to the Python service is a security incident, not a misconfiguration.
- Target LLM API keys are **encrypted at rest** and never logged.
- The per-client/per-target strategy library (discovered jailbreak strategies, attack logs) is treated as sensitive data with its own access controls — it is effectively a jailbreak knowledge base, scoped so one client can never read another's.
- Python outputs are sanitized by Node.js before reaching the React client to prevent XSS from adversarial model responses rendered in the browser.
- Python service calls to external LLM providers are validated and constrained — users cannot supply arbitrary endpoints without explicit allow-listing.

---

## API contract (Node.js → Python)

Internal versioned REST. Node.js is the only caller.

```
POST /v1/runs               Start an AutoDAN-Turbo run
GET  /v1/runs/:id           Poll status + partial results
GET  /v1/runs/:id/results   Full results payload
```

The Python service returns the model version in every response. Node.js propagates it to logs and the frontend.

---

## CI/CD notes

- Python service and Node.js are **independently deployable** (separate containers).
- Contract tests (e.g. Pact) should verify the Node.js ↔ Python interface across independent deploys.
- Python service container pins model weights and dependencies. A model registry (MLflow or DVC) is recommended if weights are versioned separately from the service.
- Environment-specific service discovery via env vars (`PYTHON_SERVICE_URL`, `REDIS_URL`, `DATABASE_URL`) — no hardcoded addresses.
