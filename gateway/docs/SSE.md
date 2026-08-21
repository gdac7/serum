# SSE live progress — how it works

This document explains the Server-Sent Events (SSE) layer that streams live run
progress from the gateway to the browser. It's written for someone new to SSE and
to Node.

## 1. What SSE is

Normal HTTP is **request → response → done**: the client asks, the server answers,
the connection closes. That's how every other gateway endpoint works.

SSE keeps the connection **open** and lets the server push messages down it over
time — one-way, server → client. The browser has a built-in client for this,
`EventSource`:

```js
const es = new EventSource("/runs/123/events");
es.onmessage = (e) => console.log(e.data); // fires on every pushed message
```

The wire format is plain text. Each message is a `data:` line followed by a blank
line:

```
data: {"type":"status","coarse":"running"}

data: {"type":"progress","discovered_this_run":2}

```

`EventSource` also **auto-reconnects** if the connection drops. We chose SSE over
WebSockets because our traffic is unidirectional (server → client only) and SSE is
much simpler for that.

**Why we want it:** a run takes minutes. Without SSE the frontend has to *poll*
(`GET /runs/:id` every few seconds) — wasteful and laggy. With SSE the gateway
pushes each status change and each newly-discovered strategy the instant it
happens.

## 2. The complication: the gateway is two processes

- `npm run dev` → the **web** process. Serves HTTP and holds the browser's open
  SSE connection.
- `npm run worker` → the **worker** process. Pulls jobs off BullMQ and drives the
  run against the Python service. **This** process is the one that learns when the
  status changes.

They are separate OS processes — no shared memory, no shared variables. The worker
cannot call `res.write()` on a connection living in the web process. We need a pipe
*between processes*, and we already run one: **Redis**.

## 3. Redis Pub/Sub — the bridge

Redis pub/sub is a simple broadcast (separate from the job queue):

- Someone **publishes** a message to a named **channel** (e.g. `run:123`).
- Anyone **subscribed** to that channel receives it immediately.
- Redis does not store it — fire-and-forget to whoever is listening now.

End-to-end flow:

```
worker process              Redis            web process                 browser
──────────────              ─────            ───────────                 ───────
status changed
  └ publishRunEvent ──▶  channel run:123 ──▶ subscriber (sse.hub)
                                              └ res.write("data: …") ──▶ EventSource.onmessage
```

The worker never touches the browser connection. It publishes to Redis; the web
process is subscribed and relays each message down the held-open HTTP stream. The
**database stays the source of truth** — SSE is an additive live layer, so a
browser that missed events can always reconnect and read real state.

## 4. The files

### `infra/run-events.ts` — the publisher (used by the worker)

Defines the shared `RunEvent` type (message shapes: `snapshot`, `status`,
`progress`, `completed`, `failed`), the `runChannel(id)` helper (`"run:" + id`),
and `publishRunEvent(id, event)` which JSON-encodes an event and publishes it on
the run's channel. It uses its **own** Redis connection.

### `infra/sse.hub.ts` — the subscriber + registry (used by the web process)

Two jobs:

- **Registry** — `Map<runId, Set<Response>>`: for each run, the set of open browser
  connections watching it. `attach` adds a connection; `detach` removes it (and
  drops the run's entry when the last watcher leaves, so the Map doesn't leak).
- **Subscriber** — one Redis connection `psubscribe`s `run:*` (pattern subscribe:
  one subscription catches every run channel). On each incoming message it strips
  the `run:` prefix to get the run id, looks up that run's watchers, and writes the
  SSE frame (`data: <json>\n\n`) to each with `res.write()` (which sends a chunk
  **without** closing the connection).

Key Redis detail: a connection in subscriber mode can't run normal commands, so the
subscriber, the publisher, and BullMQ each use a **separate** connection.

### `routes/runs.routes.ts` — `GET /runs/:id/events`

What the browser connects to. It:

1. **Authenticates via query param.** `EventSource` cannot set an `Authorization`
   header, so the JWT arrives as `?access_token=<jwt>`; the route verifies it with
   the same `authService.verifyToken` used by `requireAuth`.
2. **Checks ownership** — `findByIdForUser` (404 if not yours) before opening the
   stream.
3. **Sets SSE headers** (`Content-Type: text/event-stream`, `Cache-Control:
   no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`) and writes them.
4. **Sends a snapshot** — the current status right now, so a late-connecting browser
   isn't blank until the next change.
5. **`attach`es** the connection to the hub → it now receives live events.
6. **Heartbeats** — a `: ping` comment every 15s. Without periodic traffic, proxies
   assume the connection is dead and cut it.
7. **Cleans up** on `req.on("close")` — clears the heartbeat and `detach`es.

### Worker change — `worker/run.processor.ts`

In `pollToTerminal` (the loop that polls the Python run to a terminal state), each
tick now also calls `publishRunEvent` when something changed:

- fine Python status changed → `status` event,
- newly-discovered strategy count changed → `progress` event (best-effort; a failed
  progress poll is logged and skipped, never aborts the loop),
- terminal → `completed` / `failed` event.

The existing DB writes (`setStatus` / `setError`) stay — SSE is layered on top.

## 5. Auth trade-off

The query-param token is the pragmatic choice for `EventSource` (which can't send
headers). The downside: tokens can appear in server access logs. Fine for this
throwaway test setup; a production build would use a short-lived one-time "ticket"
instead — the browser POSTs (with the normal Bearer header) to get a ticket, then
opens `EventSource("…?ticket=…")`.

## 6. Try it

With the gateway web + worker running and the Python service reachable:

```
GET /runs/<id>/events?access_token=<jwt>
```

via `curl -N` (the `-N` disables buffering) or the test frontend, which opens an
`EventSource` in each run card and renders the live status + discovered count.
