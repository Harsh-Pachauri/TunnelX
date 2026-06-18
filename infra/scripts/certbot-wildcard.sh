#!/usr/bin/env bash
# Obtain a wildcard TLS certificate for yourdomain.dev and *.yourdomain.dev
# using the ACME DNS-01 challenge via the Cloudflare DNS plugin.
#
# Why DNS-01 (not HTTP-01): HTTP-01 can only validate a single hostname;
# a wildcard cert requires proving ownership of the zone via DNS.
#
# Prerequisites on the VPS:
#   apt install certbot python3-certbot-dns-cloudflare
#   Create /root/.cloudflare.ini:
#     dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN
#   chmod 600 /root/.cloudflare.ini
#
# Usage:
#   bash infra/scripts/certbot-wildcard.sh yourdomain.dev admin@yourdomain.dev
#
# After success, set up auto-renewal:
#   systemctl enable --now certbot.timer   # or: crontab -e → 0 3 * * * certbot renew

set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain> <email>}"
EMAIL="${2:?Usage: $0 <domain> <email>}"

certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /root/.cloudflare.ini \
    --dns-cloudflare-propagation-seconds 60 \
    -d "$DOMAIN" \
    -d "*.$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email

echo ""
echo "Certificate obtained. Update infra/nginx/tunnelx.conf to reference:"
echo "  /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "  /etc/letsencrypt/live/$DOMAIN/privkey.pem"
echo ""
echo "Then: sudo nginx -t && sudo systemctl reload nginx"
