#!/usr/bin/env bash

set -euo pipefail

ORIGIN_URL="${1:-https://127.0.0.1:443}"

echo "Starting Cloudflare Quick Tunnel for ${ORIGIN_URL}"
echo "Press Ctrl+C to stop the tunnel."

exec cloudflared tunnel \
  --url "${ORIGIN_URL}" \
  --no-tls-verify \
  --loglevel info
