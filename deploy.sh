#!/usr/bin/env bash
# Build the browser demo and publish it as static assets on Cloudflare Workers (free plan).
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (or in the file named by ENV_FILE).
set -euo pipefail
cd "$(dirname "$0")"
if [ -n "${ENV_FILE:-}" ]; then
  getenv() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
  export CLOUDFLARE_API_TOKEN="$(getenv CLOUDFLARE_API_TOKEN)" CLOUDFLARE_ACCOUNT_ID="$(getenv CLOUDFLARE_ACCOUNT_ID)"
fi
npx vite build >/dev/null
(cd deploy && npx vite build -c vite.live.config.mjs >/dev/null)   # live page -> dist/live
npx wrangler deploy 2>&1 | grep -v -i token | tail -4
