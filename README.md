# brimble-takehome

One-page deploy pipeline. Submit a Git URL or a `.tar.gz`. The api uses
[Railpack](https://railpack.com) to build an OCI image, runs the image as a
container, and routes traffic to it through Caddy at `/d/<id>/`. Build and
runtime logs stream live to the UI over SSE.

```
┌─ browser ──────────────────────────────────────┐
│   localhost:8080                               │
└────────────────────┬───────────────────────────┘
                     │
              ┌──────▼──────┐
              │    Caddy    │   ingress + dynamic reverse proxy
              └──┬───────┬──┘
       /api/*    │       │  /d/<id>/*           /*
                 │       │                       │
        ┌────────▼─┐  ┌──▼─────────┐    ┌────────▼────┐
        │   api    │  │ deploy-<id>│    │  frontend   │
        │ Fastify  │  │ container  │    │   Vite SPA  │
        │ +sqlite  │  │ (Railpack) │    │   (Caddy)   │
        └────┬─────┘  └────────────┘    └─────────────┘
             │
             │  docker-container:// brimble-buildkit
             │  /var/run/docker.sock
             ▼
        ┌──────────┐    ┌─────────────┐
        │ buildkit │    │  Docker     │
        │          │    │  daemon     │
        └──────────┘    └─────────────┘
```

## Run it

```bash
docker compose up
# open http://localhost:8080
```

First run builds the `api` and `frontend` images locally (~2–3 min cold).
Subsequent runs are warm. Pass `--build` after editing source.

Defaults are wired so nothing has to be configured. `.env` overrides:

| var | default | purpose |
| --- | --- | --- |
| `PUBLIC_PORT` | `8080` | host port Caddy binds |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | URL written into deployment records |

The first deploy pulls Node images via BuildKit, so expect ~30–60s for the
first build and ~10s for warm builds.

### Smoke test

```bash
# git URL
curl -X POST -H 'content-type: application/json' \
  -d '{"gitUrl":"https://github.com/heroku/node-js-getting-started.git"}' \
  http://localhost:8080/api/deployments

# tarball upload (sample app in this repo)
tar -czf /tmp/sample.tar.gz sample-app
curl -F 'file=@/tmp/sample.tar.gz' -F 'name=hello' \
  http://localhost:8080/api/deployments
```

Once the deployment flips to `running`, hit `http://localhost:8080/d/<id>/`.

## Layout

```
api/         Fastify + node:sqlite + dockerode
caddy/       Caddyfile (boot config; api takes over via admin API)
frontend/    Vite + TanStack Router + Query, served by Caddy
sample-app/  Trivial Node HTTP server, used as a deploy target
docker-compose.yml
```

## Pieces

### Pipeline (`api/src/pipeline.ts`)

1. Pull the source. `git clone --depth 1` for a Git URL, or extract the
   uploaded tarball into `/data/builds/<id>`.
2. `railpack build --name brimble-deploy/<id>:latest /data/builds/<id>`.
   Railpack speaks BuildKit at `docker-container://brimble-buildkit` and
   loads the resulting image into the host Docker daemon (mounted socket).
3. Start the container on the `brimble-net` network with `PORT=3000`. If a
   container with the same name already exists, replace it, so redeploys are
   idempotent.
4. Push a fresh Caddy config. Every running deployment becomes a route
   `/d/<id>/* → <container>:3000` with the prefix stripped.
5. Tail container stdout/stderr (multiplexed via `dockerode.demuxStream`)
   into the same log table so the UI shows app output alongside build
   output.

State machine: `pending → building → deploying → running` (or `failed`).
`stopped` is reserved for explicit deletes.

### Live logs (`api/src/sse.ts` + `frontend/src/useLogStream.ts`)

A single SQLite `logs` table is the source of truth. The pipeline writes to
it and broadcasts each row through an in-memory `EventEmitter` keyed on
deployment id. The SSE handler:

1. Replays everything since `Last-Event-ID` (so reconnects don't lose lines).
2. Subscribes to the bus and forwards new rows.
3. Sends a `: ping` heartbeat every 15s so intermediaries don't time out.

Caddy's `flush_interval: -1` on the `/api/*` route disables response
buffering, which is what makes builds visible while they're running rather
than only after they finish.

### Caddy (`api/src/caddy.ts`)

Caddy boots from a Caddyfile that returns 503 on `:80` and exposes the admin
API on `:2019`. The api takes over by `POST /load`-ing a JSON config built
from the current DB state. Same code path runs on every deployment change
and on api boot, so the routing table has exactly one source.

### Reconciliation (`api/src/reconcile.ts`)

On boot, the api walks every `running` deployment, asks Docker if the
container is actually up, demotes anything that's missing to `stopped`, and
re-syncs Caddy. Restarting the api preserves routing for live deployments
without any manual step.

## Decisions worth calling out

- **Full-config Caddy reloads, not patches.** The api always POSTs the
  whole config to `/load`. PATCH-by-id is fewer bytes, but generating the
  whole table from DB state means one code path covers boot, redeploy, and
  delete. It's a few KB per change, nobody cares.
- **`node:sqlite` instead of `better-sqlite3`.** Built into Node 24, no
  native build step, half the footprint. The sync API is fine for the
  write volume here.
- **No auth, no multi-tenancy.** The brief excluded these.
- **Docker socket mount, not Docker-in-Docker.** Simpler and faster; the
  `api` container becomes the trust boundary. Fine for a take-home running
  on a laptop. In production you'd want a least-privilege buildkitd worker
  with an RPC interface instead of `/var/run/docker.sock`.
- **Path-prefix routing (`/d/<id>/`) instead of subdomains.** Subdomains
  need wildcard DNS or `/etc/hosts`. The brief is "we'll run it on our
  laptops" so I picked the version that just works. Apps that emit absolute
  asset URLs in HTML will break under a path prefix; fixable by switching
  to `<id>.localhost`.
- **Hard-coded app port (3000) with `PORT=3000` injected.** Most
  node/python apps respect `$PORT`. A more general system would let the
  user declare it and probe with a TCP healthcheck.
- **In-memory pubsub for logs.** Scoped to a single api instance. Real
  Brimble would put NATS or Redis behind this so any UI can attach to any
  api node.

## What I'd do with another weekend

- **Healthchecks before flipping to `running`.** Today we mark `running`
  the moment the container starts; if it crashes during boot the user only
  finds out via the run-log stream.
- **Build-cache hits across deploys.** Right now buildkit caches at the
  layer level, but the source tree gets re-fetched on every redeploy.
  Reusing `/data/builds/<id>` and pushing a `cache-key` per-app would give
  Railpack a real cache anchor.
- **Zero-downtime redeploys.** Stop-then-start has a ~1s gap. Start the new
  container under a different name, swap the Caddy upstream, then GC the
  old one.
- **Resource limits.** No `Memory`/`CpuQuota` on the deployed containers,
  so one bad app can pin the host.
- **Subdomain routing as an option.** `<id>.localhost` is supported by
  every modern resolver and avoids the path-prefix asset-URL problem.

## What I'd rip out

- The frontend ships its own Caddy. It's there to keep `docker compose up`
  trivial, but the ingress Caddy could `file_server` the built assets
  directly, dropping a whole container.
- `LogSink` does its own line-splitting because dockerode emits chunks
  mid-line. Node's `readline` would do this with less code; I wrote it
  bespoke to control how the trailing partial line flushes.

## API surface

```
GET    /api/health
GET    /api/deployments
GET    /api/deployments/:id
POST   /api/deployments                 application/json { gitUrl, name? }
                                        multipart/form-data file=@archive.tgz
POST   /api/deployments/:id/redeploy
DELETE /api/deployments/:id
GET    /api/deployments/:id/logs        text/event-stream
```

## Time spent

Roughly one focused day. Most of the time went into the pipeline plumbing
(railpack ↔ buildkit ↔ docker socket) and the SSE replay/heartbeat logic;
the UI is intentionally bare.

## Brimble feedback

See [`BRIMBLE_FEEDBACK.md`](./BRIMBLE_FEEDBACK.md).
