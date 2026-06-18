# syntax=docker/dockerfile:1
# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app

# Copy workspace manifests — changes here bust the install cache.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/db/package.json packages/db/
COPY apps/gateway/package.json apps/gateway/

# Install all deps (devDeps included — tsx runs TypeScript at runtime).
RUN pnpm install --frozen-lockfile

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine
RUN corepack enable
WORKDIR /app

ENV NODE_ENV=production

# Copy installed modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/protocol/node_modules packages/protocol/node_modules/
COPY --from=deps /app/packages/db/node_modules packages/db/node_modules/
COPY --from=deps /app/apps/gateway/node_modules apps/gateway/node_modules/

# Copy workspace config and source (no compiled artefacts — tsx handles TS).
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/protocol/src packages/protocol/src
COPY packages/protocol/package.json packages/protocol/
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/db/package.json packages/db/
COPY apps/gateway/src apps/gateway/src
COPY apps/gateway/package.json apps/gateway/
COPY apps/gateway/tsconfig.json apps/gateway/

# /data is a named volume — PGlite writes its data file here.
VOLUME ["/data"]
ENV DATABASE_URL=/data

EXPOSE 4000

CMD ["node", "--import", "tsx/esm", "apps/gateway/src/index.ts"]
