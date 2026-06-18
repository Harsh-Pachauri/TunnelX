# syntax=docker/dockerfile:1
# ── Stage 1: build Vite assets ───────────────────────────────────────────────
FROM node:20-alpine AS build
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN corepack enable
WORKDIR /app

# Copy workspace manifests for layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/

# The dashboard has no internal workspace deps — install only what it needs.
RUN pnpm install --frozen-lockfile --filter @tunnelx/dashboard

COPY apps/dashboard/ apps/dashboard/

RUN pnpm --filter @tunnelx/dashboard build

# ── Stage 2: serve with nginx ────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY infra/nginx/dashboard.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
