# Connector — attacking a model we cannot reach

This document explains how a model that accepts no inbound connections still
gets tested. It's written for someone new to the codebase.

## 1. The problem

A target of `kind:"api"` is attacked by the red-team service calling the client's
`endpoint_url` directly. That only works when the endpoint is reachable from our
network. Two common cases are not:

- the model runs on the user's own machine (`http://localhost:7070`) — and
  `localhost` resolved on our servers is *our* machine, not theirs;
- the model runs inside a company network with no public ingress, which is the
  usual arrangement for anyone testing a model they haven't shipped yet.

Reaching *into* those machines is not an option: it needs an inbound connection,
which NAT, firewalls and corporate policy all exist to prevent.

## 2. The shape of the fix

The connection is inverted. A small script on the user's machine makes ordinary
**outbound** HTTPS requests to the gateway, asking for work:

```
user's network                          our network
--------------                          -----------
model @ localhost:7070
   ^
   | local call
redteam-connect.py ---- outbound ----> gateway   GET  /connect/poll
                        HTTPS                    POST /connect/result
                                          ^
                     endpoint_url = INTERNAL_BASE_URL/bridge/targets/<id>
                                          |
                                   red-team service
```

Outbound HTTPS is the one thing that works from essentially every network, which
is why agents, CI runners and tunnels are all built this way.

## 3. The service does not know connectors exist

This is the load-bearing design decision. A connector target is registered with
the red-team service as an ordinary `kind:"api"` target whose `endpoint_url`
points back at **this gateway** (`domain/target-config.ts`). The service does
what it always does: POST a prompt, read `{"output": ...}` back. The gateway is
what turns that call into a queued job and waits for the user's machine to
answer.

So the entire feature lives in the gateway. No Python change, no new target kind
in the service, no new contract.

## 4. The round trip

1. The service POSTs a prompt to `/bridge/targets/:id` (`routes/bridge.routes.ts`),
   authenticating with `BRIDGE_SECRET`. This route is private-network only.
2. The bridge checks a connector is actually online, then `connectorHub.dispatch`
   pushes `{job_id, prompt}` onto the Redis list `connector:jobs:<targetId>` and
   awaits a reply (`infra/connector.hub.ts`).
3. The connector is sitting in `GET /connect/poll`, blocked on `BRPOP` for that
   list. It receives the job.
4. It calls the model on its own machine and POSTs the reply to
   `/connect/result`, which publishes to `connector:reply:<jobId>`.
5. The hub's pattern subscriber resolves the promise the bridge is awaiting, and
   the bridge answers the service with `{"output": ...}`.

Steps 2 and 4 are a **request/response pair over Redis**, which is new — the
existing `sse.hub` is one-directional. It works across processes for the same
reason `sse.hub` does: the waiting HTTP request is pinned to whichever process
holds its socket, and every process receives the pattern message, so only the
one with a matching resolver acts on it.

## 5. Long polling, and why not WebSockets

`/connect/poll` holds the request open for up to 25 seconds and returns `204`
when nothing arrives. 25s is deliberate: it sits under the ~30s idle timeout that
load balancers and corporate proxies commonly impose.

A WebSocket would cut the idle round trips, but it needs an HTTP upgrade that
strict egress proxies often refuse — and the attack workload is long-running
batch work where a few hundred milliseconds per prompt is irrelevant. Plain
POST/GET is the thing most likely to work from inside a customer's network.

## 6. Tokens

The connector cannot hold a JWT: it is started once from a command line and runs
unattended, so it presents a **connector token** instead
(`middleware/connector-auth.ts`). A token authorises exactly one target's
traffic — polling for its jobs and posting its results, nothing else.

Tokens are stored as a SHA-256 hash. A 256-bit random token needs no salt or work
factor, unlike a password: there is nothing to guess and nothing reused across
sites. The plaintext is returned once, at issue time; a lost token is replaced by
rotating, never recovered. Rotation revokes rather than deletes, and a partial
unique index keeps at most one live connector per target.

## 7. Configuration

| Variable | Meaning |
|---|---|
| `PUBLIC_BASE_URL` | What the connector dials. Goes into the command the user runs, so it must resolve from *outside* our network. Validated at boot under `NODE_ENV=production`: https, non-private host. |
| `INTERNAL_BASE_URL` | What the red-team service calls. A private-network address — routing this through the public URL would send internal traffic out to the internet and back. |
| `BRIDGE_SECRET` | Presented by the service on `/bridge/*`. Not a user credential: ownership was settled when the target was registered. |

`INTERNAL_BASE_URL` feeds the endpoint URL, and the service derives `target_key`
from that URL. Changing it makes every existing connector target look new and
start an empty strategy library, so pin it to a stable service name rather than
an instance address.

## 8. Failure modes

- **No connector running** — the bridge returns `503` immediately rather than
  holding the service's request for its full 300s timeout.
- **Connector stops mid-run** — queued jobs expire and the dispatch times out at
  300s, matching `RemoteModelAPI`'s own limit.
- **The user's model errors** — the connector reports the failure with the
  endpoint's response body, so the run says what went wrong instead of timing out.
- **Stale jobs** — each job carries `expires_at` and is skipped if a connector
  picks it up after the caller gave up; the queue key also carries a TTL.

## 9. Deployment note

The bridge trusts `BRIDGE_SECRET` and the red-team service has no authentication
of its own, so both depend on the gateway and the service sharing a private
network with only the gateway publicly exposed. `/bridge/*` reachable from the
internet is a security incident, not a misconfiguration.

## 10. Testing it

`test/connector.integration.test.ts` runs the whole path against a real Redis and
the real connector script — bridge, queue, poll, a stub model, reply — including
the offline and bad-credential cases. It skips itself when no Redis is reachable.

To exercise a real public path without deploying, point `PUBLIC_BASE_URL` at a
tunnel to your local gateway (`ssh -R 80:localhost:3000 nokey@localhost.run`) and
run the connector from another network. Note the direction: `ssh -R` is initiated
*outbound* by the machine hosting the service, which is the same reason the
connector works at all.
