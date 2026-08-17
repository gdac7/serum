# Gateway completion — working log

Branch: `nodejs-gateway`. Goal: finish the remaining gateway slices (3–6) from
`.claude/rules/NEXT_STEPS.md`. This file tracks progress so work can resume later.

## Decisions taken this session
- **No output sanitization.** Earlier the plan had an XSS-sanitize step in slice 3;
  dropped by request — the target LLM responses are plain text and the gateway
  passes the Python payloads through unshaped/unescaped. (If a future real frontend
  ever renders this as raw HTML, revisit.)
- SSE authenticates via **query-param token** (`?access_token=`), because browser
  `EventSource` can't send an `Authorization` header.
- SSE cross-process transport is **Redis pub/sub** (web subscribes, worker
  publishes), since web and worker are separate processes.

## Slice 3 — read endpoints — DONE (committed)
Commit: `feat(gateway): add run read endpoints (list, results, metrics, progress)`
- `infra/redteam.client.ts`: added `getRunResults` / `getRunMetrics` /
  `getRunProgress` + response interfaces (`Generation`, `PhaseSummary`,
  `HarmbenchMetrics`, `RunResultsResponse`, `RunMetricsResponse`,
  `RunProgressResponse`).
- `repositories/run.repository.ts`: added `listByUser(userId)`.
- `services/run.service.ts`: added `listRuns`, `getResults`, `getMetrics`,
  `getProgress`; `shapeRun` widened (adds dataset/fresh_library/load_4_bits); helper
  `fromPython` maps `RedTeamServiceError` → `HttpError` preserving 409/404, and 409s
  a run with no `python_run_id`.
- `routes/runs.routes.ts`: added `GET /runs`, `/runs/:id/results`, `/metrics`,
  `/progress`.

## Slice 4 — SSE live progress — DONE (not yet committed)
See `gateway/docs/SSE.md` for the full explanation.
- NEW `infra/run-events.ts`: `RunEvent` type, `runChannel(id)`,
  `publishRunEvent(id, event)` (own Redis publisher connection).
- NEW `infra/sse.hub.ts`: `Map<runId, Set<Response>>` registry + one `psubscribe
  run:*` subscriber that fans each message out to watching browsers; exports
  `attach` / `detach`.
- `services/auth.service.ts`: extracted `verifyToken(token)`; `auth.middleware.ts`
  now uses it.
- `routes/runs.routes.ts`: added `GET /runs/:id/events` (query-token auth →
  ownership → SSE headers → snapshot → attach → 15s heartbeat → cleanup on close).
- `worker/run.processor.ts`: `pollToTerminal` now publishes `status` / `progress`
  (best-effort) / `completed` / `failed` events alongside its DB writes.
- `frontend/src/App.tsx`: `RunCard` now opens an `EventSource` and renders live
  status + discovered-strategy count (removed the old 3s poll loop and unused
  `TERMINAL`).
- Typecheck: gateway + frontend both clean. **TODO: commit this slice.**

## Slice 5 — api targets + secret handling — NOT STARTED
Plan (from the approved plan file):
- `infra/crypto.ts`: AES-256-GCM via `node:crypto` (`encrypt`/`decrypt`), key from
  new env `SECRETS_ENC_KEY`.
- `config/env.ts` + `.env.example`: add `SECRETS_ENC_KEY` (32-byte) and
  `TARGET_ENDPOINT_ALLOWLIST` (comma-separated hosts).
- `domain/dto.ts`: `createRunSchema` gains `kind` (default `local`),
  `endpoint_url`, `api_key`, `api_key_env`; `superRefine`: when `kind:"api"` require
  `endpoint_url` + `api_key_env` and enforce the allow-list.
- `infra/db/schema.sql`: `ALTER TABLE runs ADD COLUMN IF NOT EXISTS` for
  `target_kind`, `endpoint_url`, `api_key_env`, `encrypted_api_key`.
- `run.repository.ts` (`NewRun`/`RunRow`/`create`), `run.service.createRun`
  (encrypt api_key at rest), `shapeRun` (never expose the key).
- `redteam.client.ts` `TargetConfig` gains optional `endpoint_url` / `api_key_env`;
  `worker/run.processor.ts` builds the target from `run.target_kind` and forwards
  them for the `api` case.
- `infra/logger.ts`: pino `redact` for `api_key` / `encrypted_api_key` /
  `authorization`.
- **Upstream limitation (documented):** the Python service reads the API key from
  its own env var named by `api_key_env`; the key itself never transits the
  payload. The gateway therefore stores the key encrypted and forwards the env-var
  *name*; injecting the secret into the service env is NEXT_STEPS open item #1 and
  stays deferred.

## Slice 6 — vitest unit suite — NOT STARTED
- Add `vitest` devDep + `"test": "vitest run"`.
- Extract `toCoarseStatus` to `worker/status.ts` (importable).
- Tests: status mapping (all 7 Python statuses), crypto round-trip (+ tamper
  throws), `createRunSchema` validation (valid local; valid api; api missing
  endpoint_url fails; disallowed host fails; empty dataset fails).
- Note: full route/idempotency integration tests need DB+Redis+service — left as
  follow-up.

## How to run / verify
- `bash gateway/setup_db.sh`, `bash gateway/setup_redis.sh`.
- `cd gateway && npm install && npm run migrate && npm run typecheck`.
- `npm run dev` (web) + `npm run worker` (worker), Python service reachable.
- Frontend: `cd frontend && npm run dev`.
- SSE check: `curl -N "http://localhost:3000/runs/<id>/events?access_token=<jwt>"`.
