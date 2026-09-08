# Server deployment — full Docker Compose stack

Everything runs in containers: both Postgres instances, Redis, the Python
red-team service (GPU), the gateway, its worker, and the tunnel. Seven
containers, two locally-built images (`gateway` and `worker` share one).

```
internet → tunnel → gateway:3000
                      ├── gw-pg:5432
                      ├── redis:6379
                      └── redteam:8080 (GPU)
                            └── rt-pg:5432 (pgvector)
```

Compose puts every service on the `serum_default` network and resolves them by
**service name** — `http://redteam:8080`, `redis://redis:6379`, `gateway:3000`.
Nothing publishes a host port except where noted for the tunnel.

All commands run from the repo root.

---

## 1. Check prerequisites

```bash
docker compose version
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu22.04 nvidia-smi
```

The third must print the GPU. If it fails the `redteam` container gets no GPU —
install `nvidia-container-toolkit`, then `sudo nvidia-ctk runtime configure
--runtime=docker && sudo systemctl restart docker`. On rootless Docker:
`nvidia-ctk runtime configure --runtime=docker
--config=$HOME/.config/docker/daemon.json`, plus `no-cgroups = true` in
`/etc/nvidia-container-runtime/config.toml`, then `systemctl --user restart
docker`.

## 2. Create `.env`

```bash
cat > .env <<EOF
RT_PG_PASSWORD=$(openssl rand -hex 24)
GW_PG_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
SECRETS_ENC_KEY=$(openssl rand -hex 32)
BRIDGE_SECRET=$(openssl rand -hex 32)
PUBLIC_BASE_URL=https://serum.gdac7.xyz
TUNNEL_TOKEN=<your-tunnel-token>
HF_TOKEN=
LOG_LEVEL=info
JWT_EXPIRES_SECONDS=3600
EOF
```

Postgres bakes its password into the volume on first start — changing one later
means recreating the volume.

`TUNNEL_TOKEN` needs a value even before Cloudflare is set up: Compose
interpolates the whole file up front, so `${TUNNEL_TOKEN:?...}` aborts *every*
command while it is empty. The token is a credential — anyone holding it can
receive traffic for the hostname.

`PUBLIC_BASE_URL` must be a full URL **with scheme**. A bare hostname fails
`z.string().url()` and the gateway restart-loops on boot.

## 3. Build

```bash
docker compose build
```

The `redteam` image is large (torch + CUDA wheels). Several minutes.

## 4. Datastores

```bash
docker compose up -d rt-pg gw-pg redis
docker compose ps
```

## 5. Migrate both databases

```bash
docker compose run --rm redteam python -m server.db.migrate
docker compose run --rm gateway npm run migrate
```

## 6. Start the application

```bash
docker compose up -d redteam gateway worker
docker compose logs -f gateway worker redteam
```

The gateway should log `database connection ok` then `gateway listening`.

## 7. Verify from inside the network

Nothing is published to the host yet, so `curl localhost:3000` will not work —
that is expected. Note the images are slim: `node:22-slim` has **no `wget` and no
`curl`**, so use Node's built-in `fetch`. The `redteam` image does have `curl`.

```bash
docker compose exec gateway node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log)"
docker compose exec redteam curl -s http://gateway:3000/health
docker compose exec redteam nvidia-smi
```

The second one is the important one: it proves service-name resolution works, so
any tunnel container on the same network can reach `http://gateway:3000` too.

---

## 8. Expose it — ngrok, no root required

Cloudflare Tunnel needs outbound **port 7844** (UDP for QUIC, TCP for the HTTP/2
fallback). On a restricted network both are blocked and there is no fallback to
443, so the tunnel never establishes — `cloudflared` logs a pre-check with `UDP
Connectivity FAIL` / `TCP Connectivity FAIL` while `api.cloudflare.com:443`
passes. Confirm with `nc -vz region1.v2.argotunnel.com 7844`.

ngrok goes out over 443 and installs as a single binary in `$HOME`, so it works
without sudo and without the firewall change.

**The gateway port is published to the host** (`127.0.0.1:3000:3000`, already in
`docker-compose.yml`) because ngrok runs on the host, not on the Compose
network. Loopback only — the tunnel is the sole public path in.

```bash
docker compose up -d gateway
curl localhost:3000/health
```

**Install ngrok:**

```bash
mkdir -p ~/.local/bin
curl -sL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz | tar xz -C ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"        # add to ~/.bashrc
ngrok version
ngrok config add-authtoken <token>
```

Reserve the free static domain in the ngrok dashboard under **Domains**. Without
it the URL changes on every restart and every connector already handed out
breaks.

**Point the gateway at it** in `.env`, then recreate:

```
PUBLIC_BASE_URL=https://<your-domain>.ngrok-free.app
```

```bash
docker compose up -d gateway worker
docker compose stop cloudflared
```

**Run the tunnel:**

```bash
ngrok http --url=<your-domain>.ngrok-free.app 3000
# background: nohup ngrok http --url=<your-domain>.ngrok-free.app 3000 > ~/ngrok.log 2>&1 &
```

**Verify:**

```bash
curl https://<your-domain>.ngrok-free.app/health
curl -X POST https://<your-domain>.ngrok-free.app/auth/register \
     -H 'content-type: application/json' \
     -d '{"email":"you@example.com","password":"..."}'
```

### If Cloudflare becomes available later

Set `PUBLIC_BASE_URL` to the Cloudflare hostname, `docker compose up -d
cloudflared`, and in Zero Trust → Published application routes set Path
**empty** (routers mount at the root, so any pattern cuts off most of the API),
Type HTTP, URL **`http://gateway:3000`** — the *service* name. `localhost:3000`
is wrong there: `cloudflared` is a container, so `localhost` is its own
namespace.

Then block `/bridge` at the edge (Security → WAF → Custom rules):

```
(http.host eq "serum.gdac7.xyz" and starts_with(http.request.uri.path, "/bridge"))  →  Block
```

`/connect/*` stays public — that is the connector's lifeline.

---

## Security notes

- **Only the gateway is public.** The red-team service has no authentication by
  design and trusts the `client_id` Node forwards. Public ingress to it is a
  security incident, not a misconfiguration.
- **Under ngrok there is no WAF**, so `/bridge` is reachable from the internet
  and `BRIDGE_SECRET` is the only thing guarding it. Cloudflare gave defence in
  depth that this setup does not.
- `ALLOW_PRIVATE_ENDPOINTS` must stay `false` on a public gateway — the guard is
  what stops a target config becoming an SSRF vector. Targets on a user's own
  machine go through the connector instead.
- `INTERNAL_BASE_URL` feeds `target_key`. Changing it makes every connector
  target look new and start with an empty strategy library. Set once.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pull access denied for serum-gateway` | Image never built — `docker compose build`. |
| `unable to prepare context: path ... not found` | `docker build` without `-t`; the last argument is the context directory, not the image name. |
| `PUBLIC_BASE_URL: Invalid url` | Missing scheme, or the `<placeholder>` left literal. |
| Gateway `Restarting`, `curl` gives `Empty reply from server` | Rootless Docker's port forwarder accepts the connection with nothing behind it. Read `docker compose logs gateway`. |
| `wget: executable file not found` | `node:22-slim` ships neither `wget` nor `curl`. Use `node -e "fetch(...)"`. |
| Worker shows `Up` but does nothing | `npm run worker` is `tsx watch`, which survives the `process.exit(1)` from env validation — the container never restarts and looks healthy. Always check `docker compose logs worker` directly. |
| cloudflared retries forever | Outbound 7844 blocked. Use ngrok. |
| ngrok answers `502 Bad Gateway` | Nothing listening on host `:3000` — the gateway container is down (`docker compose logs gateway`) or its `ports:` mapping was lost. |

## Known operational gaps

- Restarting `redteam` drops every target's GPU weights. Runs re-register
  targets automatically; standalone chat targets need a re-`POST /targets`.
- Targets are never evicted from the in-memory `targets` dict — a VRAM leak over
  time. Restart `redteam` periodically until there is a TTL.
- The gateway mounts no CORS middleware. Serve the SPA through a same-origin
  proxy, or add `cors()` with an explicit origin allow-list.
- `docker compose down -v` deletes the volumes — both databases and every
  downloaded model weight.
