# serum

Red teaming platform for LLM agents. Monorepo of four parts:

```
apps/
  gateway/    Public API (Node 22 + Express + TypeScript). Auth, targets,
              runs, connector bridge, SSE. Owns gw-pg and the BullMQ queue.
  service/    Red-team engine (FastAPI + PyTorch, GPU). Implements the
              attack approaches; no auth of its own, trusts client_id.
  webapp/     Web app (React 18 + Vite + react-router).
  connector/  Single-file, stdlib-only Python agent users run on their own
              machine so a local model can be attacked with nothing exposed.
```

`apps/gateway` and `apps/webapp` are npm workspaces sharing the root lockfile;
`apps/service` has its own `requirements.txt` and is not part of the workspace.

## Approaches

Every attack technique lives under an approach namespace so a new one is a new
folder rather than an edit to the routers:

- Gateway: `apps/gateway/src/approaches/<id>/`, mounted at `/<id>/…`
- Service: `apps/service/src/approaches/<id>/`, served at `/v1/<id>/…`
- Web app: `apps/webapp/src/approaches/<id>/`, routed at `/<id>/…`

Auth, targets, chat, the connector and health are shared across approaches — a
target is an input to any approach, not a property of one.

Today the only approach is **`autodan`** (AutoDAN-Turbo). `GET /approaches`
serves the gateway's registry, and `GET /runs` stays outside any prefix as the
cross-approach run list.

To add one: create the three folders above, register it in each side's
registry (`approaches/registry.ts` / `.tsx`, and `APPROACH_ROUTERS` in
`apps/service/server/main.py`), and store its parameters in a `config jsonb`
column on `runs` -- the AutoDAN columns there stay as they are.

## Development

```bash
npm install          # installs both JS workspaces
npm run dev:gateway  # tsx watch on :3000
npm run dev:worker   # queue consumer
npm run dev:webapp   # vite on :5174, proxying to GATEWAY_URL
npm run typecheck
npm test
```

The Python service and the full container stack are covered in
[DEPLOY.md](DEPLOY.md).
