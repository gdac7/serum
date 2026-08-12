# Next steps

The repo holds two projects: **`service/`** (Python FastAPI red-team service —
the stable base) and **`gateway/`** (Node.js API gateway — current work). Paths
in the Python section below are relative to `service/`.

---

## Python service (stable base)

### Design decisions (binding)
- One red-team method: **AutoDAN-Turbo** (warmup / lifelong / evaluate phases).
  No method dimension in the request — `WEBPROJECT.md`'s "pair"/"direct" examples
  don't apply here.
- **attacker / scorer / summarizer** are fixed local models. **target** is the
  only per-request variable — `src/core/target_factory.py::build_target_model`
  returns `kind:"local"` (HF repo id on local GPU) or `kind:"api"`
  (`RemoteModelAPI` → client endpoint, `api_key_env` → `Authorization: Bearer`).
- **Strategy library is owned by this service**, not hydrated by Node. Built as a
  side effect of warmup/lifelong, persists **per client + per target**, accumulates
  across runs. Starting empty is explicit opt-in (`fresh_library:true`). `evaluate`
  alone is legal only when a stored library exists. `target_key` derives from
  `TargetConfig` (excludes `load_4_bits`), so re-registering reuses the library.
- **All auth lives in Node.** This service has none by design — it trusts the
  `client_id` Node forwards and only enforces ownership. Safe *only* while it stays
  internal-network-only; that boundary is the authentication.
- Stack: psycopg 3 (sync) + raw SQL in repository classes + hand-written `schema.sql`.

### What works (PostgreSQL slices 1–3, done)
- Full run pipeline end to end: `POST /v1/runs` enqueues a background task running
  the requested phases, scores evaluate generations with HarmBench, stores
  `phases`/`generations`/`metrics`.
- Routes: `POST /v1/create_client`, `POST /v1/targets` (async build),
  `GET /v1/target_health/{id}`, `POST /v1/runs`, `GET /v1/runs/{id}` (+`/results`,
  `/metrics`, `/progress`), `GET /v1/strategies[/{id}]`, `GET /v1/libraries`,
  `GET /v1/health`, `GET /v1/db_health`, `GET /v1/vram_usage`. Ownership-checked by
  `client_id`; 409 until a run is `completed`.
- Run status: `queued → warmup → lifelong → evaluating → scoring → completed|failed`.
- **State + library in PostgreSQL + pgvector** (`server/db/`): `runs`,
  `strategy_libraries` (`UNIQUE(client_id, target_key)`), `strategies`
  (`vector(384)` embeddings). Apply schema: `python -m server.db.migrate`. Service
  refuses to start without a reachable DB. `fail_interrupted` reconciles
  crash-interrupted runs to `failed` on startup.
- VRAM released between phases (~46GB peak, one phase at a time); runs serialized on
  a process-wide `gpu_lock`. Rediscovered strategies merged, not duplicated
  (name + `context_embedding` cosine ≥ 0.85).

### Known gaps
- A restart unloads every target model (GPU weights can't persist). `target_id` is
  stable (`uuid5(client_id + target_key)`), so a run just re-`POST`s `/v1/targets`
  with the same config first.
- Targets are never evicted from the in-memory `targets` dict (open item 2).
- A run shows `queued` while waiting on `gpu_lock` + loading models (30–60s); a
  `loading` status would separate the two.
- Slice 4 (prompt log store for generations/scores) deferred — not a blocker; the
  API contract Node consumes is complete without it.

---

## Node.js gateway (current task)

Sits in front of the Python service. Architecture in `WEBPROJECT.md` (layered:
route → service → repository → infra). TypeScript, run via `tsx` (no build step).
All gateway work is on the **`nodejs-gateway`** git branch, not `main`.

### Decisions (locked)
- **Separate Postgres instance** for the gateway (host port 5433; Python's is 5432).
- **`client_id = users.id`**; call Python `POST /v1/create_client` lazily in the run worker.
- **`kind:"local"` targets only** in the first run slice; `kind:"api"` + secret
  encryption deferred to slice 5.
- **SSE via Redis pub/sub, split web + worker processes** — one worker poller
  re-emits Python polling deltas as SSE to N browsers.
- Constraints from Python the gateway must respect: auth terminates in Node;
  re-register the target (idempotent) before every run; map Python's status vocab
  onto coarse `queued → running → completed → failed`; Python has **no SSE** (poll
  `/runs/{id}` + `/progress`).

### Progress
- **Slice 0 — scaffold** *(done)*: Express + TS app in `gateway/`, zod-validated
  env, pino logger, `python.client` (GET /v1/health), `GET /health` passthrough.
- **Slice 1 — auth** *(done)*: gateway Postgres (`pg` pool, `users` schema,
  `npm run migrate`), `POST /auth/register` (bcrypt), `POST /auth/login` (JWT),
  `requireAuth` middleware, protected `GET /me`; boot-time DB ping; zod validation
  + shared `HttpError` handler.

### Todo (remaining slices)
2. **Create run** — `runs` mirror table, `run.service` (validate phases, insert
   `queued`, enqueue), `POST /runs` → 202 + node_run_id, BullMQ queue + worker
   (lazy create_client → register target → `POST /v1/runs` → persist python_run_id
   → poll to terminal), status mapping. `kind:"local"` only.
3. **Read + shape + sanitize** — `GET /runs`, `/runs/:id`, `/results`, `/metrics`;
   shape Python payloads, XSS-sanitize generations, preserve 409/404.
4. **SSE live progress** — `sse.hub` (Redis sub), worker publishes deltas,
   `GET /runs/:id/events` (ownership → snapshot → attach → heartbeat).
5. **Target secrets + `kind:"api"`** — `crypto` (AES-256-GCM), `encrypted_api_key`,
   `endpoint_url` allow-list, pino redaction, forward `api_key_env`.
6. **Tests** *(optional)* — vitest: status mapping, sanitizer, run-service
   validation, retry-idempotency guard.

### Run / test
- Gateway DB: `bash gateway/setup_db.sh` (docker `postgres:17` on 5433).
- `cd gateway && npm run migrate && npm run dev`.
- Slice 1 check: register → login → `GET /me` with the token (200) → without it (401).

---

## Open design work (deferred)
1. **Secrets handling** for `api_key_env` — how the client's target API key reaches
   the service env (per-request injection vs pre-provisioned), never logged/echoed.
2. **Target model lifecycle** — targets never evicted; needs a VRAM budget or TTL
   before network-reachable.
3. **Network isolation enforcement** — bind address, firewall/security-group,
   container network policy so "internal-only" is enforced, not assumed. (Service
   auth itself is resolved: it lives in Node; this service authenticates nobody.)
4. **`server/server_llm.py`** — standalone scorer-only app; fold in or retire.
5. **Dockerfile / deployment** — GPU base image, `HF_HOME` volume mount, consolidate
   the duplicate `requirements.txt` / `src/core/requirements.txt`.
6. **Data handling policy** — retention of harmful attack prompts/responses.
7. **Test coverage** — real unit/integration tests for the Python service.
