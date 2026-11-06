#!/usr/bin/env bash
# Build the browser demo and publish it as static assets on Cloudflare Workers (free plan).
set -euo pipefail
cd "$(dirname "$0")"
ENVF=/home/agent/claude-money/.env
getenv() { grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
export CLOUDFLARE_API_TOKEN="$(getenv CLOUDFLARE_API_TOKEN)" CLOUDFLARE_ACCOUNT_ID="$(getenv CLOUDFLARE_ACCOUNT_ID)"
npx vite build >/dev/null
npx wrangler deploy 2>&1 | grep -v -i token | tail -4
