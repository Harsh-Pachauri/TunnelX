# TunnelX

A self-hosted localhost tunneling platform — an ngrok / Cloudflare Tunnel
clone. Expose a local HTTP server to the internet through a single outbound
WebSocket connection, with a gateway that multiplexes concurrent requests
over that connection.

## Status

**Stages 0-10 complete**: shared protocol package, gateway, and CLI client
form a working end-to-end tunnel — real local forwarding with streamed,
multi-chunk responses, genuinely concurrent requests multiplexed over one
WebSocket, a gateway-driven heartbeat, and CLI auto-reconnect with backoff.
Persistence is live: an embedded Postgres-compatible database
(`packages/db`) stores `users`, `api_keys`, `tunnels`, and `request_logs`;
`REGISTER` is validated against a hashed API key, and each connection's
lifecycle (connect, heartbeat, disconnect) is recorded as a `tunnels` row. A
JSON REST API under `/api` provides account registration/login (JWT access
tokens + an httpOnly refresh cookie), API key CRUD, and read-only tunnel
list/detail (including live round-trip latency). Every tunneled request —
success, error, or timeout — is asynchronously logged to `request_logs` and
readable via a paginated, filterable `/api/logs`. A React dashboard
(`apps/dashboard`) provides login/registration, an Overview of your tunnels
(active/all), per-tunnel details with recent requests, a filterable paginated
Request Logs view, and a Request Inspector that shows captured request and
response headers and body. Tunnel status and new requests are pushed in real
time over a `/api/ws/dashboard` WebSocket channel (60-second polling fallback)
rather than polled. An in-memory ring buffer (200 entries, 5-minute TTL, 64 KB
body cap per direction) backs the body preview; the DB log row is permanent.
Production infra is fully specified in `infra/`: Docker images for both apps,
compose files for local and production, Nginx host config with wildcard routing
and HTTPS, and scripts for wildcard cert issuance (DNS-01) and deploy.

See [`Planning.md`](Planning.md) for the full engineering plan and
[`docs/decisions.md`](docs/decisions.md) for the architecture decisions made
along the way.

## Architecture

- **Gateway** (`apps/gateway`) — Express + `ws` server. Accepts public HTTP
  traffic, routes it by subdomain (`Host` header) to the matching tunnel
  client over a persistent WebSocket connection, and streams the response
  back.
- **CLI** (`apps/cli`) — connects to the gateway, registers a tunnel, and
  forwards incoming requests to a local port via `http.request`, streaming
  the response back over the WebSocket.
- **Protocol** (`packages/protocol`) — shared TypeScript types + Zod schemas
  for the WebSocket message protocol (`REGISTER`, `REQUEST`,
  `RESPONSE_HEADERS` / `RESPONSE_CHUNK` / `RESPONSE_END`, `PING` / `PONG`,
  `ERROR`).
- **DB** (`packages/db`) — Drizzle ORM schema (`users`, `api_keys`,
  `tunnels`, `request_logs`) on an embedded Postgres-compatible database
  ([PGlite](https://pglite.dev/)), with migrations and a seed script. See
  `docs/decisions.md` (ADR-008) for why PGlite and its single-process
  constraint.
- **API** (`apps/gateway/src/api`, `apps/gateway/src/auth`) — JSON REST
  endpoints under `/api` for accounts, API keys, read-only tunnel info, and
  paginated/filterable request logs, protected by JWT access tokens
  (`requireAuth` middleware). See `docs/decisions.md` (ADR-012, ADR-013,
  ADR-014, ADR-015).
- **Request logging** (`apps/gateway/src/proxy/requestLog.ts`) — every
  tunneled request, on every way it can end (success, gateway timeout,
  client error, or tunnel disconnect), fires an async, metadata-only insert
  into `request_logs`. See `docs/decisions.md` (ADR-014).
- **Dashboard** (`apps/dashboard`) — a Vite + React + TypeScript app (React
  Router, TanStack Query) covering login/registration, an Overview of your
  tunnels, per-tunnel details with recent requests, a filterable paginated
  Request Logs view, and a Request Inspector (`/logs/:id`) showing captured
  headers and decoded body. Live updates are pushed over a dedicated
  `/api/ws/dashboard` WebSocket channel (JWT token via `?token=` query param,
  `verifyClient` auth, invalidation-based cache updates) rather than polled.
  See `docs/decisions.md` (ADR-016, ADR-017, ADR-018, ADR-019).
- **Body ring buffer** (`apps/gateway/src/proxy/bodyBuffer.ts`) — in-memory
  `Map` keyed by `request_logs.id`; 200-entry cap, 5-minute TTL, 64 KB cap
  per direction. Backed by `GET /api/logs/:id/body` (returns `410 Gone` when
  the entry has expired). See `docs/decisions.md` (ADR-018).

Every in-flight HTTP request is identified by a `streamId` (UUID), so many
requests can be interleaved over the single WebSocket connection.

**Resilience**: the gateway pings each tunnel client every
`HEARTBEAT_INTERVAL_MS` (default 30s) and force-closes connections that miss
`HEARTBEAT_TIMEOUT_MS` (default 60s) of PONGs, immediately failing any
requests still waiting on that tunnel. The CLI reconnects on any drop with
exponential backoff + jitter (capped at 30s) and remembers its assigned
subdomain so the public URL survives a reconnect.

## Quick start

Requires Node 20+ and pnpm (Corepack fetches the pinned version
automatically — see `docs/decisions.md` if that fails).

```bash
pnpm install

# One-time: create a dev user + API key (prints the raw key — save it)
pnpm --filter @tunnelx/db run db:seed

# Terminal 1 — a local app to expose
pnpm demo:app                          # http://localhost:3000

# Terminal 2 — the gateway (also runs DB migrations on boot)
pnpm --filter @tunnelx/gateway start   # http://localhost:4000

# Terminal 3 — the tunnel client, using the API key from db:seed
cd apps/cli && npx tsx src/index.ts http 3000 --api-key <key from db:seed>

# Terminal 4 — the dashboard
pnpm --filter @tunnelx/dashboard dev   # http://localhost:5173
```

> **Note**: `pnpm --filter @tunnelx/cli dev -- http 3000 --api-key <key>`
> looks like it should work but doesn't — pnpm forwards a literal `--` into
> the CLI's argv, which breaks Commander's flag parsing and silently falls
> back to the default key. Invoke `tsx` directly as shown above (see
> ADR-011). Also run `db:seed` only while the gateway is **stopped** — PGlite
> can't be opened by two processes at once (ADR-008).

Open <http://localhost:5173> and log in with the email/password
`db:seed` printed (`dev@tunnelx.local` / `changeme` by default). The
dashboard must run on port 5173 — the gateway's CORS config
(`DASHBOARD_ORIGIN`, see ADR-017) only allows that origin by default.

The CLI prints the assigned public URL, e.g.

```
Forwarding http://2jw859mj.localhost:4000 -> http://localhost:3000
```

Test it — no DNS setup needed, set the `Host` header directly:

```bash
curl -H "Host: 2jw859mj.localhost:4000" http://127.0.0.1:4000/
curl -H "Host: 2jw859mj.localhost:4000" http://127.0.0.1:4000/api/data
curl -H "Host: 2jw859mj.localhost:4000" -X POST -d "hello" http://127.0.0.1:4000/echo

# /slow?ms=N delays the response — fire several at once to see them
# multiplexed over the one WS connection without blocking each other.
curl -H "Host: 2jw859mj.localhost:4000" "http://127.0.0.1:4000/slow?ms=1000"

# /large streams a 100KB body back as multiple RESPONSE_CHUNK messages.
curl -H "Host: 2jw859mj.localhost:4000" http://127.0.0.1:4000/large
```

## Deploy to production

Requires a VPS (Debian/Ubuntu), Docker, a domain, and Cloudflare DNS.

```bash
# 1. On your VPS — one-time setup
git clone <this repo> && cd tunnelx
cp .env.example .env && $EDITOR .env          # fill in domain + secrets

# 2. Obtain wildcard TLS cert (DNS-01 via Cloudflare)
sudo bash infra/scripts/certbot-wildcard.sh yourdomain.dev admin@yourdomain.dev

# 3. Install Nginx config + reload
sudo cp infra/nginx/tunnelx.conf /etc/nginx/sites-available/tunnelx.conf
# Replace "yourdomain.dev" in the file with your real domain
sudo ln -s /etc/nginx/sites-available/tunnelx.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4. Build images and start containers
bash infra/scripts/deploy.sh

# 5. Seed a dev user (stop gateway first — PGlite is single-process)
docker compose -f infra/docker-compose.prod.yml stop gateway
docker compose -f infra/docker-compose.prod.yml run --rm gateway \
  node --import tsx/esm packages/db/src/seed.ts
docker compose -f infra/docker-compose.prod.yml start gateway
```

After that, `https://app.yourdomain.dev` serves the dashboard and
`https://<subdomain>.yourdomain.dev` is the tunnel ingress. Run the CLI
from any machine:

```bash
# --gateway is the full WS URL; any *.yourdomain.dev subdomain routes to
# the gateway (or use app.yourdomain.dev/ws/tunnel — both work).
npx tsx apps/cli/src/index.ts http 3000 \
  --gateway wss://gateway.yourdomain.dev/ws/tunnel \
  --api-key <key from seed>
```

See `docs/decisions.md` (ADR-020) for the full infrastructure rationale.

## Auth & API

The gateway also exposes a JSON REST API under `/api` for accounts, API
keys, and read-only tunnel info — call it directly (no `Host` header /
subdomain), since that's how the dashboard will reach it too. Full contract
in `Planning.md` §10.

```bash
# Register — also sets an httpOnly refresh-token cookie
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"at-least-8-chars"}'

# Use the returned accessToken on protected routes
curl http://localhost:4000/api/api-keys \
  -H "Authorization: Bearer <accessToken>"

# Create an API key for the CLI (the raw "key" is shown once)
curl -X POST http://localhost:4000/api/api-keys \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"name":"laptop"}'

# List your tunnels (add ?status=all to include disconnected ones)
curl "http://localhost:4000/api/tunnels?status=active" \
  -H "Authorization: Bearer <accessToken>"

# Paginated, filterable request logs across all your tunnels.
# Filters: tunnelId, status (e.g. "404" or "5xx"), method, path
# (substring), from/to (ISO date bounds), page, pageSize (max 100).
curl "http://localhost:4000/api/logs?status=5xx&page=1&pageSize=20" \
  -H "Authorization: Bearer <accessToken>"

# A single log entry by id
curl http://localhost:4000/api/logs/1 \
  -H "Authorization: Bearer <accessToken>"
```

`POST /api/auth/refresh` (cookie-based) issues a new `accessToken`;
`POST /api/auth/logout` clears the cookie. See ADR-012/ADR-013 in
`docs/decisions.md` for the JWT strategy and route design, including a
known dev-only `/api` path collision with tunneled apps (resolved by Nginx's
Host-based split in production). See ADR-014/ADR-015 for the
`request_logs` write pipeline (every request-termination path, not just
success) and the `/api/logs` read contract.

## Repository layout

```
apps/
  gateway/          # public-facing HTTP + WS gateway
  cli/              # tunnel client
  dashboard/        # React dashboard (Vite + React Query + React Router)
packages/
  protocol/         # shared WS message types + Zod schemas
  db/               # Drizzle schema, migrations, seed script (PGlite)
examples/
  demo-app/         # zero-dependency local server used for testing
docs/
  decisions.md      # architecture decisions log (ADRs)
Planning.md         # full engineering plan
```
#   T u n n e l X  
 