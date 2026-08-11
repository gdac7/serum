# Next steps: FastAPI service

## Decided so far

- **attacker / scorer / summarizer** are fixed local models, loaded once (as today, directly via `LocalModelTransformers`) — not client-configurable.
- **target** is the only per-request variable: `src/core/target_factory.py::build_target_model(target_cfg)` returns either:
  - `kind: "local"` — any HF repo id, loaded in-process on this machine's GPU (weights pulled from HF Hub with the service's own credentials, client never uploads anything).
  - `kind: "api"` — `RemoteModelAPI` calls the client's own hosted endpoint (`endpoint_url`, optional `api_key_env` -> sent as `Authorization: Bearer`).
- `configs/base_config.yaml` no longer has a `target` entry — it's supplied per-request.
- Cloud deployment plan for local targets: mount a persistent volume, point `HF_HOME` at it (`local_models.cache_dir` in config) so weights survive container restarts instead of re-pulling every run.
- Repo cleaned: `tests/`, `notebooks/`, `data/`, `configs/test_config.yaml` removed.

## Decided since (see WEBPROJECT.md)

- There is **one red-team method**: AutoDAN-Turbo. No PAIR, no method
  dimension in the request — `WEBPROJECT.md`'s original "pair"/"direct"
  example methods don't apply to this service.
- The **strategy library is owned by this Python service**, not hydrated
  per-request by Node.js. It's built as a side effect of running
  warmup/lifelong phases and persists **per client + per target** across
  requests. A client supplying their own pre-built library is a future
  feature, out of scope now.
- Routes: `POST /v1/runs` (start a run), `GET /v1/runs/:id` (status/partial
  results), `GET /v1/runs/:id/results` (full results). No `/v1/scenarios`.
- **All authentication happens in the Node.js gateway. This service has none,
  by design.** Node validates the user's JWT, resolves them to a `client_id`,
  and passes that `client_id` down. This service treats it as a trusted,
  already-authenticated identifier and only enforces *ownership* with it
  (a client never reads another client's runs or strategy library). It never
  sees a JWT, a password, or a user record. This is safe exactly as long as
  the service stays internal-network-only and unreachable from the internet —
  that network boundary *is* the authentication.

## Progress so far

- `POST /v1/create_client`, `POST /v1/targets` (async build via `BackgroundTasks`), `GET /v1/target_health/{id}`, `GET /v1/health`, `GET /v1/vram_usage` all live in `server/main.py`.
- **The full run pipeline works end to end.** `POST /v1/runs` enqueues a background task that executes the requested phases (`warmup_exploration`, `lifelong_learning`, `evaluate`) against the client's target, scores the evaluate generations with HarmBench, and stores everything under `runs[run_id]["result"]` as `phases` / `generations` / `metrics`.
- Read endpoints: `GET /v1/runs/{id}` (status), `/results` (full payload), `/metrics` (ASR/RSR), `/progress` (strategies discovered so far, best-effort file read). All ownership-checked against `client_id`; 409 when a run isn't `completed` yet.
- Run status reports the phase — `queued → warmup → lifelong → evaluating → scoring → completed | failed`. Node.js maps these onto WEBPROJECT.md's coarser `running`.
- Response models are named `AutoDAN*` so a second red-team approach can define its own.
- **VRAM is released between phases.** `server/model_registry.py::ModelRegistry` loads `shared`/`scorer` on demand and frees them at the end of a run; `get_harmbench_values.release_classifier()` frees the 13B classifier after scoring. Peak is one phase's models (~46GB) rather than all of them (~72GB), which is what decides the GPU tier the cloud deployment pays for. Runs are serialized on a process-wide `gpu_lock`.
- HarmBench eval (`src/harmbench_eval/get_harmbench_values.py`) takes a generations dict + an output path and returns ASR (successes / all attempts) and RSR (behaviors with >= 1 success / behaviors). The multi-approach/multi-model shape it was written for is gone.
- In-memory state (`runs`, `targets`, `users` dicts) — deliberate; PostgreSQL comes later.
- **PostgreSQL + pgvector storage layer is live** (`server/db/`). `schema.sql` defines `strategy_libraries` (scoped by `UNIQUE (client_id, target_key)`) and `strategies` (embeddings in a `vector(384)` column); `pool.py` opens a `ConnectionPool` in `lifespan` with the pgvector adapter registered per connection; `migrate.py` applies the schema explicitly (`python -m server.db.migrate`); `StrategyRepository` holds every query, bound to one connection so the caller's `with pool.connection()` block *is* the transaction boundary. `server/target_key.py` derives a target's cross-run identity from its config. `GET /v1/db_health` confirms the extension and row counts. The service now refuses to start without a reachable database.
- **The library is wired into the run pipeline.** `POST /v1/runs` resolves the client+target library before enqueueing, and `run_autodan_task` hydrates it into `AutoDANTurbo.strategy_library` before the first phase. Persistence is a callback: `AutoDANTurbo` takes `on_strategy_discovered` and knows nothing about SQL, while the server's sink writes each validated strategy on its own short-lived pool connection. `fresh_library: true` on the request skips hydration without deleting anything; evaluate-only runs 409 when no stored library exists. `GET /v1/runs/{id}/progress` now reads the library from Postgres and reports `loaded_from_library` / `discovered_this_run`.
- **Rediscovered strategies are merged, not duplicated.** `_is_novel_strategy` was dead code returning `True`; it now treats a strategy as a duplicate only when the name matches *and* the `context_embedding` cosine clears a threshold (0.85 default), since strategies are retrieved by the embedding of the target response they overcame and the same technique against a different response is a genuinely new retrieval anchor. Merges call `update_effectiveness` and reach Postgres via `StrategyDiscoverer.on_strategy_merged`, wired to `AutoDANTurbo._emit_strategy`. Note the dedup threshold (0.85) is far stricter than the retrieval threshold (0.3), so near-duplicates within retrieval range are still kept — tune once real similarity numbers show up in the logs.
- **Library inspection:** `GET /v1/strategies?client_id&target_id` (with `name` / `limit` / `newest_first`) and `GET /v1/strategies/{strategy_id}?client_id`, ownership enforced by joining `strategy_libraries` in SQL.

## Known gaps in what works today

- **A restart still unloads every target model.** Identity now survives (`target_id` is `uuid5(client_id + target_key)`, clients auto-provision, and `GET /v1/libraries` reads libraries with no in-memory state), but GPU weights cannot persist, so a run needs `POST /v1/targets` with the same config first — which returns the same `target_id` as before.
- Targets accumulate forever in the `targets` dict; nothing evicts them (open item 2).
- A run reports `queued` while it waits on `gpu_lock` and loads the attacker/scorer (30-60s of looking idle while working). A `loading` status would separate the two.

## Current task: PostgreSQL persistence

The concrete driver for the PostgreSQL learning arc.

**Decisions (2026-08-09), binding:**
- The library **accumulates per client + target across runs**. Starting from an
  empty library is an explicit opt-in on the run request, never the default.
- `lifelong`'s purpose is *producing* the library, so the meaningful phase sets
  are `warmup/lifelong/evaluate` or `lifelong/evaluate`. `evaluate` alone is
  legal only when a stored library exists — reject it otherwise.
- `target_key` derives from `TargetConfig`, not the per-request `target_id`
  uuid, so re-registering the same model reuses its library. `load_4_bits` is
  excluded from target identity: quantization is a deployment detail, not a
  different set of guardrails.
- Stack: psycopg 3 (sync) + plain SQL in a repository class + hand-written
  `schema.sql`. Raw SQL over an ORM on purpose — the point is learning
  PostgreSQL, not SQLAlchemy.

**Slices:**

1. ~~**Strategy library storage**~~ — *done 2026-08-09*, see Progress above.
2. ~~**Wire the library into the run pipeline**~~ — *done 2026-08-09*, see
   Progress above.
3. **Run state** — `runs` / `targets` / `users` currently die with the process and don't span workers. This is the table-design and transaction-boundary exercise.
4. **Generations and scores** — WEBPROJECT.md's "prompt log store", access-controlled separately from general app data.

## Open design work (deferred)
1. **Secrets handling** for `api_key_env` — how the client's target API key actually reaches the service process's env (per-request secret injection vs. pre-provisioned env vars), and making sure it's never logged or echoed back.
2. **Target model lifecycle** — `ModelRegistry` handles the fixed models; targets are still never evicted. Size and count are client-controlled and unbounded, so this needs a VRAM budget or a TTL before it's network-reachable.
3. ~~**Service auth**~~ — *resolved by architecture decision, see "Decided since"*. Auth lives entirely in Node.js; this service authenticates nobody. What replaces it is a **deployment requirement, not code**: the service must never be exposed outside the internal network (no public ingress, no port-forward in production). If that ever changes, service auth comes back as an open item.
4. **Network isolation enforcement** — the flip side of item 3. Bind address, firewall/security-group rules, and container network policy need to be pinned down in the deployment config so "internal-only" is enforced rather than assumed.
5. **`server/server_llm.py`** — currently a standalone scorer-only FastAPI app with a hardcoded model. Decide whether it's folded into the new main service or retired.
6. **Dockerfile / deployment** — GPU base image, `HF_HOME` volume mount, and consolidating the duplicate `requirements.txt` / `src/core/requirements.txt` before containerizing.
7. **Data handling policy** — this system generates harmful/jailbreak content for red-teaming; logging and retention of attack prompts/responses needs an explicit policy before this is network-reachable.
8. **Test coverage** — `tests/` was removed as dead weight (tied to the old manual scripts); once the service shape is decided, add real unit/integration tests for it (`target_factory`, request handling, etc.).
