#!/usr/bin/env bash
# Deploy TunnelX on the VPS using Docker Compose.
# Run from the repo root after git pull.
#
# Prerequisites:
#   - Docker + Docker Compose installed on the VPS
#   - .env file exists at repo root (cp .env.example .env && fill in values)
#   - Nginx configured (infra/nginx/tunnelx.conf) and wildcard cert obtained
#
# Usage:
#   bash infra/scripts/deploy.sh

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
    echo "Error: .env not found. Copy .env.example and fill in your values."
    exit 1
fi

echo "→ Pulling latest changes..."
git pull --ff-only

echo "→ Building images and starting services..."
docker compose -f infra/docker-compose.prod.yml up --build -d

echo "→ Gateway:   http://127.0.0.1:4000  (proxied via *.yourdomain.dev)"
echo "→ Dashboard: http://127.0.0.1:5000  (proxied via app.yourdomain.dev)"
echo ""
echo "Done. Check logs with: docker compose -f infra/docker-compose.prod.yml logs -f"
