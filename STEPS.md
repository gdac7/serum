# Gateway completion — working log

Branch: `nodejs-gateway`. Goal: finish the remaining gateway slices (3–6) from
`.claude/rules/NEXT_STEPS.md`. **All four slices are DONE and committed.**

## Decisions taken this session
- **No output sanitization.** Earlier the plan had an XSS-sanitize step in slice 3;
  dropped by request — the target LLM responses are plain text and the gateway
  passes the Python payloads through unshaped/unescaped. (If a future real frontend
  ever renders this as raw HTML, revisit.)
- SSE authenticates via **query-param token** (`?access_token=`), because browser
  `EventSource` can't send an `Authorization` header.
- SSE cross-process transport is **Redis pub/sub** (web subscribes, worker
  publishes), since web and worker are separate processes.
- **No vendor allow-list** for api endpoints (dropped as pointless). Replaced by a
  lightweight **SSRF guard** (`infra/url-guard.ts`): require https, reject
  loopback/private/link-local hosts. String-level only (no DNS resolution).
- The throwaway `frontend/` gets the slice-4 SSE change only; slice-5 api form was
  intentionally skipped — the frontend will be rebuilt later.

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

## Slice 5 — api targets + secret handling — DONE (committed)
Commit: `feat(gateway): support kind:"api" targets with encrypted secrets`
- NEW `infra/crypto.ts`: AES-256-GCM (`encrypt`/`decrypt`), key from env
  `SECRETS_ENC_KEY` (64 hex chars, validated in `config/env.ts`).
- NEW `infra/url-guard.ts`: `isPublicHttpsUrl` (SSRF guard, see decisions).
- `config/env.ts` + `.env.example`: add `SECRETS_ENC_KEY` (no allow-list var).
- `domain/dto.ts`: `createRunSchema` gains `kind` (default `local`),
  `endpoint_url`, `api_key`, `api_key_env`; `superRefine` requires
  `endpoint_url` + `api_key_env` for api and runs the SSRF guard.
- `infra/db/schema.sql`: `ALTER TABLE runs ADD COLUMN IF NOT EXISTS`
  `target_kind` / `endpoint_url` / `api_key_env` / `encrypted_api_key`.
- `run.repository.ts` (`NewRun`/`RunRow`/`create`), `run.service.createRun`
  (encrypts `api_key` at rest), `shapeRun` (exposes `target_kind`/`endpoint_url`/
  `api_key_env` names, never the key).
- `redteam.client.ts` `TargetConfig` + `worker/run.processor.ts` build local/api
  target from `run.target_kind`, forwarding `endpoint_url` + `api_key_env`.
- `infra/logger.ts`: pino `redact` for key fields + `authorization` +
  `access_token`.
- **Upstream limitation (documented):** Python reads the API key from its own env
  var named by `api_key_env`; the key never transits the payload. Gateway stores it
  encrypted and forwards the env-var *name*. Injecting the secret into the service
  env is NEXT_STEPS open item #1, still deferred.

## Slice 6 — vitest unit suite — DONE (committed)
Commit: `test(gateway): add vitest unit suite for status, crypto, dto, url guard`
- Added `vitest` devDep + `"test": "vitest run"` + `vitest.config.ts` (supplies a
  test env so env-reading modules import).
- Extracted `toCoarseStatus` → `worker/status.ts`.
- 16 tests across `test/{status,crypto,dto,url-guard}.test.ts`, all passing.
- Route/idempotency integration tests (need DB+Redis+service) left as follow-up.

## Remaining setup on the run machine
- Add `SECRETS_ENC_KEY` to `gateway/.env` (`openssl rand -hex 32`).
- `cd gateway && npm install && npm run migrate` (applies the 4 new run columns).

## How to run / verify
- `bash gateway/setup_db.sh`, `bash gateway/setup_redis.sh`.
- `cd gateway && npm install && npm run migrate && npm run typecheck && npm test`.
- `npm run dev` (web) + `npm run worker` (worker), Python service reachable.
- SSE check: `curl -N "http://localhost:3000/runs/<id>/events?access_token=<jwt>"`.
