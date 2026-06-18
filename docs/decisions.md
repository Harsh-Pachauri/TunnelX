# Architecture Decisions Log

Lightweight ADR log for choices made while building TunnelX. Each entry: what we
decided, why, and when to revisit. Keeps the AI-assisted build aligned with
`Planning.md` and gives a paper trail for interview questions about "why is it
built this way."

## ADR-001: pnpm workspaces monorepo

**Decision**: `apps/*` (gateway, cli, dashboard) and `packages/*` (protocol, db,
shared-types) live in one pnpm workspace.

**Why**: Gateway, CLI, and dashboard all depend on the shared `protocol` package
(WS message types + Zod schemas). A monorepo with `workspace:*` links keeps them
in lockstep without publishing to a registry.

**Revisit if**: Apps need independent release cadences (unlikely for a
single-developer project).

**Environment note**: `package.json` pins `"packageManager": "pnpm@9.12.0"`.
Corepack's default "latest" (pnpm 11.6.0 at the time of writing) crashes on
Node 20.16 with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; 9.12.0 is a known-good
version. If `pnpm install` fails with a `Cannot find matching keyid` signature
error, Corepack's bundled signing keys predate an npm registry key rotation —
run with `COREPACK_INTEGRITY_KEYS=0` set (or update Corepack).

## ADR-002: Dev runs TS source directly via tsx — no build step yet

**Decision**: `packages/protocol`'s `package.json` exports point straight at
`src/index.ts`. `apps/gateway` and `apps/cli` run via `tsx watch src/index.ts` /
`tsx src/index.ts`. Every `tsconfig.json` sets `noEmit: true`.

**Why**: There's no deployment target yet (no Docker image), so a compile step
would add rebuild-before-run friction with no payoff. tsx + Node's `NodeNext`
resolution handle cross-package `.ts` imports transparently.

**Revisit when**: Containerization stage. Give `packages/protocol` a real
`build` script emitting `dist/`, add conditional `exports` (source for dev,
`dist` for prod), and compile gateway/cli for the Docker images.

## ADR-003: Subdomains are generated in-memory, not DB-backed (v1)

**Decision**: On `REGISTER`, the gateway generates an 8-char lowercase
alphanumeric subdomain (`nanoid` custom alphabet) and checks only the live
in-memory registry for collisions. Nothing is persisted yet.

**Why**: The goal of this build pass is a working transport + proxy
(gateway <-> CLI <-> local server). Persistent collision-checking, reserved
names, and user-chosen subdomains belong with the Postgres-backed `tunnels`
table.

**Revisit when**: Postgres integration lands. The `tunnels` table's partial
unique index on `(subdomain) WHERE status='active'` becomes the source of
truth; the in-memory registry becomes a cache over it.

## ADR-004: No auth on REGISTER yet

**Decision**: `apiKey` is part of the `REGISTER` message and sent by the CLI,
but the gateway does not validate it yet.

**Why**: Keeps the wire protocol stable (no breaking message-shape changes
later) while deferring the `api_keys` table, hashing, and lookup logic.

**Revisit when**: Auth APIs land. Validate in `handleRegister` (in
`apps/gateway/src/ws/server.ts`) and reject with `ERROR { code: 'INVALID_API_KEY' }`
before registering the tunnel.

## ADR-005: Hop-by-hop headers are stripped, not forwarded verbatim

**Decision**: `connection` and `transfer-encoding` are stripped from both the
outbound request (CLI -> local server) and the response headers sent back
(CLI -> gateway -> client). All other headers, including `content-length` and
`content-encoding`, pass through unchanged.

**Why**: The gateway and CLI each manage their own connection/chunking with
Node's `http` APIs; forwarding the original `connection`/`transfer-encoding`
values can conflict with that. Bodies are moved byte-for-byte via base64, so
`content-length` from the local server stays accurate.

## ADR-006: Gateway-driven heartbeat with `terminate()` on timeout

**Decision**: After `REGISTER`, the gateway starts a `setInterval` per
connection (`apps/gateway/src/ws/heartbeat.ts`) that sends `PING` every
`HEARTBEAT_INTERVAL_MS` (default 30s) and tracks `lastPongAt`. If no `PONG`
arrives within `HEARTBEAT_TIMEOUT_MS` (default 60s), the gateway calls
`ws.terminate()` (not `close()`) to force the socket shut immediately. The
existing `ws.on('close')` handler then unregisters the subdomain and calls
`pendingRequests.failAllForTunnel(tunnelId, 502, 'Tunnel disconnected')` so
any requests already in flight to that tunnel get an immediate response
instead of waiting out `REQUEST_TIMEOUT_MS`.

**Why**: The gateway is the side with many connections to police, so it
initiates. `terminate()` vs `close()` matters: `close()` waits for a clean
handshake that a half-dead peer may never complete, while `terminate()`
guarantees the `close` event (and therefore cleanup) fires.

**Verified**: with `HEARTBEAT_INTERVAL_MS=3000` / `HEARTBEAT_TIMEOUT_MS=8000`,
observed regular PING/PONG pairs in the gateway log, and confirmed killing the
CLI mid-request resolves the pending HTTP response with `502 Tunnel
disconnected` in ~180ms rather than the 30s request timeout. The
`terminate()`-on-timeout branch itself (vs. the close-handler path) wasn't
separately exercised — that requires a peer that stops responding without
closing the TCP connection, which isn't easy to simulate on local loopback.

**Revisit if**: a multi-instance gateway needs to distinguish "client is slow"
from "client is gone" more precisely (e.g. missed-ping counters instead of a
single timeout window).

## ADR-007: CLI reconnects with exponential backoff + jitter, remembers its subdomain

**Decision**: `apps/cli/src/connection/tunnel.ts` wraps connection setup in a
`connect()` function called again from `ws.on('close')`. Backoff is
`min(30_000, 1000 * 2^attempt) + random(0, 1000)` ms, uncapped attempt
counter, reset to 0 on `REGISTERED`. The gateway-assigned `subdomain` and a
per-process `clientId` (both generated once, outside `connect()`) are reused
on every reconnect via `requestedSubdomain`, so a transient drop reconnects to
the same public URL. If the gateway replies `SUBDOMAIN_TAKEN` (e.g. someone
else claimed it while we were down), the remembered subdomain is cleared so
the next attempt accepts a fresh one instead of looping forever on a name we
can't have. All gateway-bound sends go through a `safeSend()` that no-ops
unless `ws.readyState === OPEN`, so a local response that finishes after the
socket has already closed can't throw.

**Why**: ngrok-style tunnels are meant to be left running unattended; a CLI
that gives up after one dropped connection (or one that hammers the gateway in
a tight loop) is unusable. Jitter avoids a thundering herd if many CLIs
reconnect to a restarted gateway at once.

**Verified**: killed the gateway process while the CLI was connected — CLI
logged backoff delays of ~1.1s, 2.0s, 4.6s, 8.7s, 16.4s (doubling + up to 1s
jitter), and on attempt 5 (after the gateway was restarted) reconnected and
was re-registered under the *same* subdomain, with a working tunnel
immediately after.

**Revisit when**: auth lands — a reconnect after a long outage may need to
re-validate `apiKey` / refresh a token before `REGISTER` is accepted.

## ADR-008: Embedded PGlite for Postgres-compatible persistence

**Decision**: `packages/db` uses `@electric-sql/pglite` (a WASM build of real
Postgres) via `drizzle-orm/pglite`, persisting to `packages/db/pgdata/`
(gitignored). `runMigrations()` runs `drizzle-orm/pglite/migrator` against
this directory on every gateway boot. `DATABASE_URL`, if set, overrides the
data directory path.

**Why**: Planning.md §3 calls for "Postgres + migrations", but no local
Postgres instance with known credentials was available. PGlite runs the real
Postgres query planner/engine compiled to WASM — `drizzle-kit generate`
targets `dialect: 'postgresql'`, so the schema, migrations, and queries are
identical to what a real Postgres deployment would use. Zero external setup
(no Docker, no service to start/stop) for a single-developer project.

**Critical constraint — single process only**: a PGlite filesystem data
directory must be opened by **at most one Node process at a time**. Each
`new PGlite(dir)` loads the on-disk cluster into its own in-memory WASM
instance; a second concurrent instance doesn't see the first's writes, and —
observed directly — opening the same `pgdata/` from a second process while
the gateway holds it open left the directory in a state where even the
*original* process aborted on its next restart (`_pg_initdb` /
`RuntimeError: Aborted()`). Practical implications:

- `pnpm --filter @tunnelx/db run db:seed` must run **while the gateway is
  stopped** (it runs its own `runMigrations()` + seed + exits cleanly) —
  never concurrently with a running gateway.
- Ad-hoc inspection of `pgdata` must go through the running gateway process
  itself (e.g. a temporary debug route using its existing `db` instance),
  never a separate script pointed at the same directory.

**Verified**: confirmed via `Get-ChildItem` that `pgdata/` retains the
standard Postgres cluster layout (`PG_VERSION`, `base/`, `pg_wal/`, etc.), but
a second concurrent PGlite instance against it throws `DrizzleQueryError: ...
cause: RuntimeError: Aborted() ... at Object.Module._pg_initdb`. Recovered by
deleting `pgdata/` (gitignored, dev-only data) and rebuilding in the correct
order: `db:seed` once (single process: migrates, seeds, exits), then start
the gateway (loads the result fresh, no concurrent writer).

**Revisit when**: moving to a real Postgres (Docker or managed). Swap
`client.ts`'s driver from `drizzle-orm/pglite` to `drizzle-orm/node-postgres`,
point `DATABASE_URL` at a `postgres://` connection string, and `migrate.ts` to
`drizzle-orm/node-postgres/migrator`. The single-process constraint disappears
— real Postgres handles concurrent connections natively, so `db:seed` and the
gateway can run concurrently again.

## ADR-009: `users` / `api_keys` / `tunnels` schema matches Planning.md §5

**Decision**: `packages/db/src/schema/{users,apiKeys,tunnels}.ts` implement
the three tables exactly as specified in §5 (`request_logs` deferred to
Stage 7):

- `users`: `email` unique + not null, `password_hash`, timestamps.
- `api_keys`: `user_id` FK `ON DELETE CASCADE`, `key_prefix` (display) +
  `key_hash` (unique, sha256) split, `(user_id)` index, nullable
  `last_used_at` / `revoked_at`.
- `tunnels`: `user_id` FK `ON DELETE CASCADE`, `api_key_id` FK
  `ON DELETE SET NULL` (nullable — revoking a key shouldn't delete tunnel
  history), `status` with `CHECK (status IN ('active','inactive'))` default
  `'active'`, `(user_id)` index, partial unique index
  `tunnels_active_subdomain_idx` on `(subdomain) WHERE status='active'`, and
  partial index `tunnels_active_status_idx` on `(status) WHERE status='active'`.

API keys are generated as `tx_<32-char base64url>`
(`randomBytes(24).toString('base64url')`); `key_prefix` is the first 11 chars
(`tx_` + 8) for display, `key_hash` is `sha256(rawKey)` hex. The raw key is
shown once at creation (`db:seed` prints it) and never stored.

**Why**: §5's rationale applies directly — the partial unique index lets a
subdomain be reused across historical (inactive) sessions while guaranteeing
only one *live* tunnel claims it; the partial status index is the exact query
`reconcileStaleTunnels()` runs on boot; hash+prefix means a leaked database
dump doesn't expose usable API keys.

**Verified**: `drizzle-kit generate` produced `0000_cuddly_victor_mancha.sql`
with all of the above — `gen_random_uuid()` defaults, both unique constraints,
both partial indexes, the CHECK constraint, and CASCADE/SET NULL FKs, matching
§5 column-for-column.

**Revisit when**: `request_logs` lands in Stage 7 (bigserial PK, per §5's
write-volume rationale) and dashboard JWT auth in Stage 6 (reads
`users`/`api_keys` but doesn't change this schema).

## ADR-010: `tunnels` rows track connection sessions, written by the gateway

**Decision**: `apps/gateway/src/db/queries.ts` ties the `tunnels` table to the
WS connection lifecycle:

- `authenticateApiKey(rawKey)` hashes the key, looks up `api_keys` by
  `key_hash` with `revoked_at IS NULL`, touches `last_used_at`, and returns
  `{ userId, apiKeyId }` or `null`.
- On `REGISTER`, `handleRegister` (now `async`) calls `authenticateApiKey`
  first — an invalid/revoked key gets `ERROR { code: 'INVALID_API_KEY' }` and
  the socket is closed before any subdomain is assigned. On success,
  `createTunnelSession()` inserts a `tunnels` row (`status='active'`,
  `connected_at=now()`) keyed by the new `tunnelId`.
- On WS close, `closeTunnelSession(tunnelId)` sets `status='inactive'`,
  `disconnected_at=now()`.
- On each `PONG`, `touchTunnelHeartbeat(tunnelId)` updates
  `last_heartbeat_at`.
- On gateway boot, `reconcileStaleTunnels()` sets any leftover
  `status='active'` rows (from a previous process — the in-memory registry
  always starts empty) to `inactive` with `disconnected_at=now()`.

DB writes from the close/PONG paths are fire-and-forget
(`.catch(err => console.error(...))`) so a transient DB error can't crash the
WS handler.

**Why**: per §5, each *connection session* is a row, not a mutable "tunnel
config" — a reconnect is a new row, giving free connection history for the
dashboard. Tying creation to a successful DB insert (rather than just the
in-memory `registry.register()`) means the in-memory state and the DB can
never disagree about whether a *currently active* tunnel exists — if the
insert fails, the in-memory registration is rolled back and the socket closed.

**Verified** end-to-end with a seeded user/key
(`pnpm --filter @tunnelx/db run db:seed`):

- Invalid key → `INVALID_API_KEY`, socket closed, no `tunnels` row created.
- Valid key → `REGISTERED`, a proxied request through the tunnel succeeds, and
  the `tunnels` row appears with `status='active'`, correct
  `user_id`/`api_key_id`/`subdomain`/`target_port`, `connected_at` set,
  `disconnected_at`/`last_heartbeat_at` null.
- After one heartbeat interval, `last_heartbeat_at` populates (ADR-006's
  gateway-driven PING/PONG now also persists).
- Killing the CLI process flips the row to `status='inactive'` with
  `disconnected_at` set.

**Revisit when**: Stage 7 adds `request_logs` (FK → `tunnels.id`); Stage 6
dashboard reads this table for the connection-history views described in §5.

## ADR-011: pnpm's `--` separator breaks `--api-key` parsing in `cli dev`

**Decision**: documented as a known issue —
`pnpm --filter @tunnelx/cli dev -- http <port> --api-key <key>` does **not**
pass `--api-key` through as expected. pnpm 9.12.0 forwards a literal `"--"`
token into the script's argv
(`tsx src/index.ts "--" "http" "3000" "--api-key" "<key>"`), and Commander
then treats everything after that as positional arguments, never parsing
`-k/--api-key` — the CLI silently falls back to its default (`dev-key`).
**Workaround**: invoke `tsx` directly, bypassing the pnpm script wrapper:
`cd apps/cli && npx tsx src/index.ts http <port> --api-key <key>`.

**Why**: discovered while verifying Stage 5 — a seeded, verifiably-correct API
key was rejected as `INVALID_API_KEY`. Significant effort went into ruling out
the DB/PGlite layer (it was correct) before finding the actual cause was in
argv parsing, not auth.

**Revisit when**: convenient — add a `bin` entry / installed CLI command
(`tunnelx`) so users invoke it directly instead of through `pnpm ... dev --`,
which sidesteps this entirely. Until then, docs should show the `npx tsx` form
for any invocation that needs flags.

## ADR-012: JWT access/refresh tokens with stateless refresh, bcrypt passwords

**Decision**: `apps/gateway/src/auth/{password,jwt,middleware}.ts` implement:

- Passwords are hashed with `bcryptjs` (10 rounds) — the same library
  `packages/db`'s seed script already uses.
- `POST /api/auth/register` and `/login` return `{ user: {id,email},
  accessToken }` and set an httpOnly `tunnelx_refresh_token` cookie
  (`SameSite=Lax`, `Path=/api/auth`, `Max-Age` = `REFRESH_TOKEN_TTL_SEC`).
- Both tokens are signed with one secret (`JWT_SECRET`, env-overridable, dev
  default provided), discriminated by a `type: 'access' | 'refresh'` claim
  that `verifyAccessToken` / `verifyRefreshToken` each check — so an access
  token can't be replayed as a refresh token even though they share a secret.
- The access token (default 15 min, `ACCESS_TOKEN_TTL_SEC`) is returned in
  the response body only and never persisted; the refresh token (default 7
  days, `REFRESH_TOKEN_TTL_SEC`) lives only in the httpOnly cookie.
- `requireAuth` middleware reads `Authorization: Bearer <token>`, verifies
  it's an unexpired access token, and sets `req.user = {id, email}`.
- `POST /api/auth/refresh` reads the cookie, verifies it, confirms the user
  still exists, and issues a new access token (the refresh token itself is
  not rotated). `POST /api/auth/logout` clears the cookie — 204, no
  server-side state change.

**Why**: §5's schema has `users` / `api_keys` / `tunnels` but no
`refresh_tokens` table, and §10 doesn't call for one — a stateless refresh
token (verified by signature + `exp`, no DB lookup) matches the schema as-is.
Splitting the access token (response body) from the refresh token (httpOnly
cookie) is the standard mitigation for token theft via XSS: page JS can read
and attach the access token to API calls but never the refresh token. A
single secret with a `type` claim avoids managing two secrets while still
preventing token-type confusion.

**Verified**: full flow against a fresh user (`alice@example.com`): register
→ `201` with `accessToken` + `Set-Cookie`; duplicate register → `409`; login
with wrong password → `401`; login with correct password → `200` (same
shape); `GET /api/api-keys` without `Authorization` → `401`, with a valid
access token → `200`; `POST /api/auth/refresh` with the cookie → `200` new
`accessToken`, without the cookie → `401`; `POST /api/auth/logout` → `204`.

**Revisit if**: "log out everywhere" / token revocation is needed (e.g. a
leaked refresh token). Would require a `token_version` column on `users` or a
`refresh_tokens` table, checked on every refresh — not on the current roadmap
(§3/§5), so deferred until it is.

## ADR-013: Read-only `/api` REST surface, mounted ahead of the proxy catch-all

**Decision**: `apps/gateway/src/api/{auth,apiKeys,tunnels,index}.ts` implement
the §10 REST contract:

- `index.ts` now does
  `app.use('/api', express.json(), cookieParser(), apiRouter)` **before**
  `app.all('*', handleTunnelRequest)`, with the JSON/cookie middleware scoped
  to `/api` only (not global) — so the catch-all proxy still sees the raw,
  unconsumed body stream for tunneled requests of any content type.
- API keys: `GET/POST /api/api-keys`, `DELETE /api/api-keys/:id` (sets
  `revoked_at`, `204`; `404` if not owned / not found / already revoked).
  Key generation (`tx_<base64url>`, prefix, sha256 hash) now lives in
  `packages/db/src/apiKey.ts` (`generateApiKey` / `hashApiKey`), shared by
  `db:seed` and `POST /api/api-keys`.
- Tunnels: `GET /api/tunnels?status=active|all` and `GET /api/tunnels/:id`,
  read-only and scoped to `req.user.id`. Per §10 there is deliberately **no
  `POST /api/tunnels`** — tunnels are a side effect of WS `REGISTER`.
  `latencyMs` comes from the in-memory registry's new `lastLatencyMs`,
  computed in the `PONG` handler (`ws/server.ts`) as `Date.now() -
  pong.timestamp` (the CLI echoes the `PING`'s original timestamp per
  ADR-006) — `null` until the first heartbeat completes, and never persisted.
- `apps/gateway/src/db/queries.ts` was split into
  `db/queries/{users,apiKeys,tunnels}.ts` (+ barrel `index.ts`), since each
  table now has both WS-driven mutations and REST-driven CRUD/reads.

**Why**: §10 explicitly frames the no-`POST /api/tunnels` design as a "clean
interview answer" — tunnels can only come from an authenticated WS
`REGISTER`. Scoping `express.json()` / `cookie-parser` to `/api` rather than
globally is the only way to add JSON body parsing for the new routes without
breaking ADR-005's byte-for-byte proxying (a global `express.json()` would
consume the body stream of any tunneled request with `Content-Type:
application/json` before `handleTunnelRequest` ever saw it).

**Known limitation (dev only)**: Express matches `/api/*` by path regardless
of `Host`, so a tunneled app that itself exposes e.g. `POST /api/auth/login`
would have that request intercepted by the gateway's own auth router if hit
via `http://<subdomain>.localhost:4000/api/auth/login` — path alone can't
distinguish "control-plane API" from "tunnel traffic to a path that happens to
start with /api". In production this doesn't arise: §2's Nginx config splits
`*.tunnelx.dev` (tunnel traffic) from `app.tunnelx.dev` (control plane, where
the dashboard + this API live) by `Host` before either reaches the gateway.
Not fixed locally — the collision needs an exact path *and* method match
against one of the eight `/api/*` routes, and replicating Nginx's split inside
the gateway would add complexity with no production benefit.

**Verified**: created, listed, and revoked an API key via REST; used the
freshly-created key to `REGISTER` a CLI tunnel (succeeds); `GET
/api/tunnels?status=active` showed it with `latencyMs: null`, then
`latencyMs: 2` and a populated `lastHeartbeatAt` after one heartbeat interval;
`GET /api/tunnels/:id` included `apiKeyId` / `lastHeartbeatAt`;
`status=bogus` → `400`. After revoking the key and disconnecting the CLI,
`GET /api/tunnels?status=all` showed `status: 'inactive'` with
`disconnectedAt` set, and restarting the CLI with the revoked key produced
`ERROR INVALID_API_KEY` on every reconnect attempt.

**Revisit when**: Stage 7 adds `request_logs` (new read endpoints, e.g.
`/api/tunnels/:id/logs`); Stage 8's dashboard becomes the first browser
consumer of this API (CORS, and `secure: true` on the refresh cookie once
served over HTTPS).

## ADR-014: `request_logs` write pipeline — every termination path, not just RESPONSE_END

**Decision**: `packages/db/src/schema/requestLogs.ts` adds `request_logs`
exactly per §5 — `bigserial` PK, `tunnel_id uuid` FK `ON DELETE CASCADE`,
`stream_id`, `method`, `path`, nullable `status_code`/`duration_ms`,
`request_bytes`/`response_bytes` (default 0), nullable `client_ip`/
`user_agent`/`error`, `created_at`. Indexes: `(tunnel_id, created_at DESC)`
(via Drizzle's `.desc()` on the index column) and `(created_at)`. Migration
`0001_slow_mandarin.sql`.

The insert is fired by a single helper, `recordRequestLog` in
`apps/gateway/src/proxy/requestLog.ts`, called from **all four** ways a
pending request can end, not just `RESPONSE_END`:

1. `handleResponseEnd` (`ws/server.ts`) — the happy path, `error: null`.
2. The gateway's 30s response timeout (`proxy/router.ts`) — `error:
   'timeout'`, `status_code` falls back to `504` if no `RESPONSE_HEADERS`
   ever arrived.
3. A client `ERROR` message for this stream (`handleClientError`) — `error:
   msg.code.toLowerCase()` (e.g. `'local_connection_refused'`).
4. `pendingRequests.failAllForTunnel`, when the tunnel's WS connection drops
   while requests are still in flight — `error: 'tunnel_disconnected'`.

`PendingRequest` (`proxy/pendingRequests.ts`) gained `method`, `path`,
`requestBytes`, `clientIp`, `userAgent`, and `statusCode` — the last one set
by `handleResponseHeaders` so it survives until whichever terminal handler
runs. `recordRequestLog` computes `duration_ms` from the existing
`startTime` and swallows/logs insert errors so a DB hiccup never affects an
HTTP response that's already been sent.

**Why**: §3's Stage 7 line ("on `RESPONSE_END`, fire an async insert") names
the happy path, but §5 already designed `status_code`/`duration_ms` as
nullable and `error` as free text with examples `'timeout'` and
`'local_connection_refused'` — columns that would otherwise never be
populated. A request that 502s or times out is exactly the kind of thing a
developer opens the Request Logs page to debug, so logging only successes
would leave a real gap. Centralizing in one helper keeps each of the four
call sites a small, uniform addition rather than four divergent
implementations.

**Verified**: five tunneled requests (`GET /`, `GET /api/data`, `POST
/echo`, `GET /slow?ms=300`, `GET /large`) each produced a correct row
(`request_bytes: 24` for the 24-byte POST body, `response_bytes: 100000` for
`/large`'s five 20KB chunks, `duration_ms: 323` for the 300ms `/slow`). A
second tunnel pointed at a port with nothing listening produced a `502` row
with `error: 'local_connection_refused'`. Gateway log showed zero insert
errors throughout.

**Revisit when**: Stage 9's Request Inspector adds the small in-memory,
per-tunnel, capped/TTL'd ring buffer of request/response *bodies* (§1 point
3, §9) — that's deliberately separate from `request_logs`, which stays
metadata-only. Also: the retention job from §5/§11 Q21 (`DELETE WHERE
created_at < now() - interval '30 days'`, supported by the `(created_at)`
index) doesn't exist yet — `request_logs` will grow unbounded until then.

## ADR-015: `GET /api/logs` and `GET /api/logs/:id` — paginated, filterable, scoped via `tunnels`

**Decision**: `apps/gateway/src/api/logs.ts`, mounted at `/api/logs`, behind
`requireAuth`, matching §10's "Request Logs" table:

- `GET /api/logs?tunnelId=&status=&method=&path=&from=&to=&page=&pageSize=`
  → `{ items, total, page, pageSize }`. Defaults `page=1`, `pageSize=20`
  (max 100). `request_logs` has no `user_id` column (ownership flows through
  `tunnel_id` → `tunnels.user_id` per §5), so every query in
  `db/queries/requestLogs.ts` inner-joins `tunnels` and filters on
  `tunnels.user_id = req.user.id`.
- `status` accepts an exact code (`404`) or a class (`2xx`…`5xx`), validated
  by a regex in `api/schemas.ts`'s `logsQuerySchema`; a class becomes
  `status_code BETWEEN N00 AND N99`.
- `path` is an `ILIKE '%...%'` substring match; `method` is upper-cased
  before comparing; `from`/`to` are inclusive `created_at` bounds (any
  `Date.parse`-able string).
- If `tunnelId` is supplied, it's checked with the existing `getTunnelById`
  first and 404s if it doesn't belong to the caller — turns a typo'd filter
  into a clear error instead of a silently-empty page.
- `GET /api/logs/:id` — `:id` is the `bigserial` PK (400 if not a positive
  integer), 404 if the row doesn't exist or its tunnel isn't owned by the
  caller, same join as the list query.

**Why**: this is exactly §10's contract and §9's filter set ("tunnel, status
range, method, path substring, date range"). `GET /api/logs/:id/body` (the
ring-buffer-backed body preview) and the Tunnel-Details convenience route
`GET /api/tunnels/:id/logs` are explicitly **not** included — both belong to
dashboard-era work (§9) postponed to Stages 8/9, and `/api/logs/:id/body`
specifically depends on ADR-014's "Revisit when" ring buffer, which doesn't
exist yet.

**Verified**: against the 6 rows from ADR-014's test — full list (`total:
6`, newest-first); `page=1&pageSize=2` / `page=2&pageSize=2` returned
disjoint id pairs with a stable `total`; `status=5xx` → 1 row (the 502),
`status=2xx` → 5 rows; `method=post` (lowercase) → the `/echo` row;
`path=slow` → the `/slow?ms=300` row; `tunnelId=<owned>` → 5 rows,
`tunnelId=<random uuid>` → `404`; `GET /api/logs/3` → full row,
`/api/logs/999999` → `404`, `/api/logs/abc` → `400`; no `Authorization`
header → `401`; `status=999` → `400`.

**Revisit when**: Stage 8 wires this into the dashboard's Request Logs
table (likely polling-based per §3); Stage 9 adds `/api/logs/:id/body` and
`/api/tunnels/:id/logs`.

## ADR-016: Dashboard scaffold — Vite/React/TS, colocated DTOs, no Tailwind, scope cuts

**Decision**: `apps/dashboard` is a Vite + React 18 + TypeScript app
(`@vitejs/plugin-react`), with React Router v6 for navigation and TanStack
React Query v5 for data fetching/caching, matching §9's stack. It has its
own `tsconfig.json`/`tsconfig.node.json` (`module`/`moduleResolution`:
`ESNext`/`Bundler`, `jsx: react-jsx`, extensionless relative imports) rather
than extending `tsconfig.base.json` — the gateway/CLI/db packages' `NodeNext`
settings (which require `.js` extensions on relative imports) don't fit a
bundler-based app.

Within that scaffold, three scope decisions:

- **DTO types are colocated**, not generated from a shared package:
  `src/api/types.ts` hand-mirrors the gateway's REST response shapes
  (`User`, `TunnelSummary`/`TunnelDetail`, `RequestLog`/`RequestLogPage`,
  etc.) as plain interfaces. No `packages/shared-types`.
- **No Tailwind** — `src/index.css` is a hand-rolled dark theme using CSS
  custom properties, with reusable classes (`.card`, `.table`, `.badge` +
  status-class variants, `.btn`, `.pagination`, `.filters`, ...).
- **Settings is entirely out of scope** for Stage 8, not just deferred
  "polish" — there is currently no dashboard UI for API-key management;
  that remains a REST-only operation (ADR-013).

Pages: `/login`, `/register` (public); `/` (Overview — tunnel list with an
Active/All toggle, `GET /api/tunnels?status=`), `/tunnels/:id` (Tunnel
Details — `GET /api/tunnels/:id` plus a "recent requests" table), and
`/logs` (Request Logs — filterable/paginated `GET /api/logs`), all behind
`ProtectedRoute`. Tunnel Details' "recent requests" reuses `GET
/api/logs?tunnelId=<id>&pageSize=50` rather than adding a new
`/api/tunnels/:id/logs` route. The root `QueryClient` sets
`defaultOptions.queries.refetchInterval = 5000` globally — simple
polling-based "live" updates. The Request Logs filter form runs through a
400ms `useDebouncedValue` before entering the React Query key, so typing in
the `status`/`path` inputs doesn't fire a request (and possible 400, for a
half-typed status like `"5"`) on every keystroke.

**Why**: §9 lists "a typed API client generated from `packages/shared-types`"
and "Tailwind is fine" — but generating types would mean the dashboard's
Vite/esbuild toolchain consuming TS source from a workspace package whose
sibling (`packages/db`) has Node-only runtime dependencies, for the sake of
~6 small interfaces with exactly one consumer; hand-mirroring is less
machinery for the same result. "Tailwind is fine" permits rather than
mandates it, and the dark theme's surface area (a handful of reusable
classes) doesn't need a utility framework. §3's "Postpone: ... Settings
polish" is read as "the Settings page, including any polish, doesn't exist
yet" — there's nothing to polish. Reusing `/api/logs?tunnelId=` for Tunnel
Details' recent-requests table follows ADR-015's precedent of not adding a
near-duplicate route.

**Verified**: `pnpm -r run typecheck` passes across all five workspace
projects (dashboard, protocol, db, gateway, cli); `pnpm --filter
@tunnelx/dashboard build` succeeds (97 modules → ~220KB JS / ~4.4KB CSS,
gzip ~69KB). End-to-end in a browser against the live gateway: Overview's
Active/All toggle correctly showed an active tunnel only under "All" until
a CLI client connected with a key belonging to the logged-in user, after
which it appeared under "Active" too, with correct subdomain, public URL,
target, latency, and connected timestamp; Tunnel Details listed that
tunnel's 7 most recent requests with correct method/path/status/duration/
size; Request Logs' Method and Path filters each correctly narrowed the
table and updated the pagination total; a request made via `curl` after the
page loaded appeared in the Request Logs table within 5 seconds with no
manual reload, confirming the polling `refetchInterval`.

**Revisit when**: Stage 9 replaces the 5s poll with a WS push channel and
adds the Request Inspector (depends on ADR-014's "Revisit when" ring
buffer). If a second consumer of the gateway's `/api` ever needs these DTOs,
revisit `packages/shared-types` — with two consumers, hand-mirroring becomes
the worse trade-off. A Settings page (API-key management, account info) is
still entirely unbuilt.

## ADR-017: Dashboard auth — in-memory access token, silent refresh, CORS with credentials

**Decision**: `apps/dashboard/src/api/client.ts` holds the access token in a
module-level variable (`setAccessToken`/`accessToken`) — never in
`localStorage`/`sessionStorage`. The refresh token remains the httpOnly
`tunnelx_refresh_token` cookie from ADR-012, sent via `credentials:
'include'` on every `fetch`.

- `AuthProvider` (`src/auth/AuthContext.tsx`) calls `POST /api/auth/refresh`
  once on mount to silently re-authenticate after a page reload (the access
  token doesn't survive a reload since it's only in memory).
  `ProtectedRoute` shows a loading state until that resolves, then redirects
  to `/login` on failure.
- `apiFetch` retries exactly once on a `401`: it calls a shared
  `refreshAccessToken()` (in-flight calls are deduplicated via one promise),
  retries the original request if the refresh succeeded, and otherwise calls
  `onAuthLost` (clears auth state; `ProtectedRoute` then redirects to
  `/login`).
- The nav shows the logged-in user's email by base64url-decoding the access
  token's payload client-side (`userFromToken`, no signature
  verification) — display only. No API call's authorization depends on this;
  every request is still verified server-side by `requireAuth`. This avoids
  adding a `/api/account`/`/api/me` endpoint, which doesn't exist.
- Gateway: new `config.dashboardOrigin` (env `DASHBOARD_ORIGIN`, default
  `http://localhost:5173`); `/api` is now mounted behind `cors({ origin:
  config.dashboardOrigin, credentials: true })`, ahead of `express.json()`
  and `cookieParser()`.

**Why**: keeping the access token out of persistent storage and the refresh
token out of page JS entirely (httpOnly) is the XSS mitigation ADR-012
already designed for — the dashboard is just the first consumer to exercise
it from a browser. ADR-013 flagged "Stage 8's dashboard becomes the first
browser consumer of this API (CORS...)" as a known gap; an explicit
allow-listed origin with `credentials: true` is required because `*` is
invalid for credentialed requests. `localhost:5173` and `localhost:4000` are
different origins but same-site, so ADR-012's `SameSite=Lax` refresh cookie
is still sent across the port boundary without further changes. Decoding the
JWT for display avoids scope creep into a new account endpoint for a value
(the user's own email) the dashboard already has in encoded form.

**Verified**: logged in via the dashboard's login form as the seeded user —
nav showed `dev@tunnelx.local`; reloaded the page and the silent refresh
re-authenticated without bouncing to `/login`; logging out redirected to
`/login`, and navigating to `/` while logged out also redirected to
`/login`. Cross-port `fetch`es from `localhost:5173` to
`localhost:4000/api/*` succeeded with the refresh cookie attached throughout
(the reload/silent-refresh flow above depends on exactly this).

**Revisit when**: a production deploy puts the dashboard behind the same
origin as the gateway (per §2's Nginx split) or on a different top-level
domain — `dashboardOrigin` becomes a real per-environment config value, and
the refresh cookie needs `Secure` (and possibly `SameSite=None`) over HTTPS,
as ADR-012 also flagged. If an `/api/me`-style endpoint is ever added,
prefer it over client-side JWT decoding.

## ADR-018: In-memory body ring buffer — design and limits

**Decision**: request and response bodies are captured in a singleton
`BodyBuffer` (`apps/gateway/src/proxy/bodyBuffer.ts`) — a plain `Map<number,
BufferedRequest & { timer }>` keyed by the DB `request_logs.id`, not the
`streamId`. Capacity: 200 entries max (oldest evicted on overflow) with a
per-entry 5-minute TTL (via `setTimeout(...).unref()`). Bodies exceeding 64
KB (`BODY_CAP`) per direction are not stored; the entry still exists but its
`requestBody`/`responseBody` field is `null` and the corresponding
`*Truncated` flag is `true`. After the TTL, the buffer entry is deleted; the
`GET /api/logs/:id/body` endpoint returns `410 Gone` if the entry is absent.
The DB log row is permanent — only the body preview expires.

- **`insertRequestLog` now returns `Promise<number>`** (the new row's `id`).
  After the insert resolves, `recordRequestLog` calls `bodyBuffer.store(logId,
  ...)` and `dashboardEvents.emitNewRequest(userId, { id: logId, ... })`. The
  body is converted to base64 before storage so the wire format from
  `GET /api/logs/:id/body` can be decoded by any JS client using `atob`.
- **Request body** is captured in `router.ts` before forwarding (the body is
  already read into a `Buffer` there, so no extra stream consumption). Bodies
  > 64 KB are not stored; `requestBody` is `null` and `requestBodyTruncated`
  is `true`.
- **Response body** is accumulated chunk-by-chunk in `ws/server.ts`
  `handleResponseChunk`. Chunks are pushed onto `pending.responseBodyChunks`
  until `responseBodySize + chunk.length > BODY_CAP`, at which point
  `responseBodyTruncated` is set and no further chunks are stored.
- **`GET /api/logs/:id/body`** is guarded by the same `requireAuth`
  middleware + ownership check as `GET /api/logs/:id`: the log row is fetched
  first (404 if not found or not owned), then the buffer is looked up (410 if
  expired).

**Why**: keeping bodies out of the database avoids blowing up the PGlite file
with multi-KB blobs that are only needed for a brief inspection window. A
short TTL (5 min) prevents memory creep from long-running sessions with many
requests; 200 entries and 64 KB caps are safe upper bounds for a development
tool — the full memory footprint is at most ~12 MB per direction. Keying by
DB id (not streamId) gives the HTTP endpoint a direct O(1) lookup without a
secondary index.

**Revisit when**: a persistent body store (e.g., a separate
`request_log_bodies` table or an object-storage sidecar) is needed for
production retention. If the 5-minute TTL causes friction (e.g., slow-loading
Inspector pages miss the window), consider extending to 15–30 minutes or
making the TTL configurable.

## ADR-019: Dashboard WebSocket push channel

**Decision**: a second WebSocket server at `/api/ws/dashboard` pushes live
events (`tunnel_status`, `new_request`) to connected dashboard clients,
replacing the previous 5-second polling refetch interval (now 60-second
fallback).

**Gateway side**:
- `DashboardEventBus` (`ws/dashboardEvents.ts`) — singleton `Map<userId,
  Set<WebSocket>>`. `subscribe(userId, ws)` adds the socket and auto-removes
  it on `close`. `emitTunnelStatus` / `emitNewRequest` serialize the event to
  JSON and call `ws.send` on every `OPEN` socket for that user. Uses
  `WebSocket.OPEN` (the static class constant, not `ws.OPEN`) to check
  readyState.
- `verifyDashboardClient` in `ws/dashboardServer.ts` — called manually in the
  `upgrade` handler (see below); extracts the JWT access token from the
  `?token=` query parameter and calls `verifyAccessToken` (synchronous,
  throws on invalid/expired). On success it attaches the parsed payload as
  `req.__user` so `handleDashboardConnection` can pick up the `userId`
  without re-reading the token.
- **`noServer` pattern** (`index.ts`) — both WebSocket servers use
  `noServer: true` instead of the `server` option. The HTTP server's
  `upgrade` event is handled manually, routing by path: `/ws/tunnel` →
  `wss.handleUpgrade`, `/api/ws/dashboard` → verify-then-`dashboardWss
  .handleUpgrade`, anything else → `socket.destroy()`. This is required
  because when two `ws` `WebSocketServer` instances share the same HTTP
  server via the `server` option, each adds its own `upgrade` listener;
  the one whose path doesn't match calls `abortHandshake(socket, 400)` which
  destroys the socket even though the other server already accepted it,
  causing a 1006 on the client. The `noServer` + manual routing pattern is
  the approach the `ws` README documents for multi-server setups.
- `tunnel_status` events are emitted on REGISTERED, PONG, and close.
  `new_request` events are emitted after `insertRequestLog` resolves (same
  place body storage fires), carrying the full `RequestLog` DTO so the
  dashboard doesn't need a follow-up fetch.

**Dashboard side**:
- `useDashboardWS` (`lib/useDashboardWS.ts`) — a React effect hook that opens
  `ws://<api-base>/api/ws/dashboard?token=<accessToken>` once the auth status
  is `'authenticated'`. On `tunnel_status` events it invalidates the
  `['tunnels']` and `['tunnel', tunnelId]` React Query cache keys; on
  `new_request` it invalidates `['logs']` and `['tunnel', tunnelId]`. This
  causes in-flight `useQuery` calls to refetch immediately without a separate
  fetch-merge step. Reconnects with exponential backoff (1s → 30s, via
  `onclose`). The effect cleanup stops reconnection and closes the socket.
  The hook is called unconditionally in `Layout` so the connection is
  maintained across all protected pages.
- `refetchInterval` in `QueryClient` defaults is lowered from 5 000 ms to
  60 000 ms — it now acts as a long-term fallback (self-heal after a missed
  push) rather than the primary liveness mechanism.
- The access token is passed via query string (not `Authorization` header)
  because browsers do not allow setting custom headers on the WebSocket
  handshake; `getAccessToken()` (exported from `api/client.ts`) reads the
  in-memory access token set by the auth flow.

**Verified**: tunnel appeared in the dashboard Overview immediately on CLI
connection (via `tunnel_status` push, no polling interval needed); new
requests appeared in the Request Logs list within ~200ms of the curl
completing; the Request Inspector (`/logs/:id`) showed decoded request
headers, `No body.` for a GET, response headers, and the JSON response body.

**Revisit when**: the access token is moved to a cookie (removes the
query-string exposure of the token in server logs and CDN caches — though
the token is short-lived and localhost-only in development). If dashboard
users require scoped fan-out (e.g., team-shared tunnels), the event bus
needs to partition by team rather than userId.

## ADR-020: Production infrastructure — Docker, Nginx, TLS

**Decision**: Gateway and dashboard are each packaged as Docker images.
Production runs via `docker compose -f infra/docker-compose.prod.yml up -d`
on a single VPS. A host Nginx process (not containerised) handles TLS
termination and routes by hostname to the two containers.

**Nginx routing** (`infra/nginx/tunnelx.conf`):
- `*.yourdomain.dev` → `gateway:4000` — all tunnel traffic (HTTP + tunnel
  WS at `/ws/tunnel`). The `Host` header is preserved so the gateway can
  look up the subdomain in the registry.
- `app.yourdomain.dev/api/` → `gateway:4000` — REST API + dashboard WS
  at `/api/ws/dashboard`. WebSocket upgrade headers (`Upgrade`,
  `Connection`) are forwarded.
- `app.yourdomain.dev/` → `dashboard:5000` — React SPA static files served
  from an `nginx:alpine` container with `try_files $uri /index.html` for SPA
  routing.
- HTTP → HTTPS redirect (301) for all hostnames.

**Wildcard TLS via DNS-01** (`infra/scripts/certbot-wildcard.sh`): A single
`certbot certonly --dns-cloudflare` call obtains a cert covering both the
apex (`yourdomain.dev`) and the wildcard (`*.yourdomain.dev`). HTTP-01 can't
validate wildcards (the ACME spec prohibits it); DNS-01 proves domain
ownership by placing a `_acme-challenge` TXT record via the Cloudflare API.
`infra/scripts/certbot-wildcard.sh` is a one-time setup script; `certbot
renew` (run via `systemctl enable certbot.timer`) handles renewal
automatically.

**Why Nginx is not containerised**: The wildcard cert lives on the VPS host
(`/etc/letsencrypt/`). Putting Nginx in a container would require bind-
mounting the cert directory and triggering `nginx -s reload` from a
hook after renewal — non-trivial. A host Nginx (or Caddy, if you prefer
automatic HTTPS) is simpler and already the common deployment pattern for
Let's Encrypt + Docker.

**Gateway Docker image** (`apps/gateway/Dockerfile`): Two-stage build. Stage
1 installs all workspace dependencies (devDeps included). Stage 2 copies
the installed `node_modules` and the TypeScript source; the gateway runs via
`node --import tsx/esm` at runtime. This avoids adding `build` scripts and
`outDir` config to the shared internal packages (`packages/protocol`,
`packages/db`), which export their TypeScript source directly via `"main":
"./src/index.ts"`. The runtime cost of tsx's TypeScript transform is
negligible vs. the alternative of refactoring all three packages' export
maps — a clear YAGNI call.

**PGlite data volume**: The gateway container sets `DATABASE_URL=/data` and
declares `/data` as a `VOLUME`. In the compose files, this maps to a named
Docker volume (`gateway-data`) so PGlite's data file survives container
restarts and rebuilds. The path is overridable via the `DATABASE_URL`
environment variable.

**Dashboard Docker image** (`apps/dashboard/Dockerfile`): Two-stage build.
Stage 1 runs `vite build` with `VITE_API_BASE_URL` injected as a build ARG
(e.g. `https://app.yourdomain.dev`). Stage 2 is `nginx:alpine` serving the
static `dist/` output. The dashboard makes requests to `/api/...` relative
to the `VITE_API_BASE_URL` origin; in production that URL is
`app.yourdomain.dev`, so Nginx on the VPS proxies those calls to the
gateway transparently.

**Revisit if**: The user base grows beyond a single VPS — at that point,
move the PGlite-backed gateway to a proper PostgreSQL server and put the
gateway behind a load balancer backed by a Redis registry (ADR-005 / §11
Q26–27). The Nginx config doesn't change; only the gateway and its
persistence layer do.
