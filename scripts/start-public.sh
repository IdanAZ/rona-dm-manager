#!/bin/bash
# Starts the app and a Cloudflare quick tunnel. Run this on a network that can
# reach region1.v2.argotunnel.com (UDP/TCP 7844 or HTTP/2). Then paste the
# printed https://*.trycloudflare.com URL into .env as APP_URL, restart the app,
# and use that origin in the Meta dashboard.
# NOTE: quick-tunnel URLs change every time cloudflared restarts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
: "${PORT:=3000}"
CLOUDFLARED="${CLOUDFLARED:-cloudflared}"
command -v "$CLOUDFLARED" >/dev/null || CLOUDFLARED=/tmp/cloudflared
if [ ! -x "$CLOUDFLARED" ]; then
  echo "cloudflared not found. Install it or place the binary at /tmp/cloudflared." >&2
  exit 1
fi
mkdir -p data
if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  nohup npm start > data/app.log 2>&1 &
  echo $! > data/app.pid
  echo "Started app, pid $(cat data/app.pid)"
fi
echo "Starting quick tunnel -> http://127.0.0.1:${PORT}"
echo "After the URL appears: set APP_URL to it in .env, restart npm, and update Meta."
exec "$CLOUDFLARED" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate
