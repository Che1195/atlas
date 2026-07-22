#!/usr/bin/env bash
# Post-deploy smoke check (pipeline step; docs/spec/11-testing-strategy.md §6).
# Usage: PROD_URL=https://atlas-....vercel.app bun run smoke
# Optional: MCP_URL=https://<deployment>.convex.site/mcp bun run smoke
#   — also POSTs an unauthenticated `initialize` handshake and expects 401
#   (proves the /mcp endpoint is up and auth-gated). Skipped if MCP_URL is
#   unset — no fixed relationship between PROD_URL (Vercel) and the Convex
#   HTTP actions origin to derive it from.
set -euo pipefail

if [ -z "${PROD_URL:-}" ]; then
  echo "smoke: PROD_URL not set — skipping (set it once Vercel prod exists)" >&2
  exit 0
fi

status="$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL")"
if [ "$status" != "200" ]; then
  echo "smoke: FAILED — $PROD_URL returned $status" >&2
  exit 1
fi
echo "smoke: OK ($PROD_URL -> 200)"

if [ -z "${MCP_URL:-}" ]; then
  echo "smoke: MCP_URL not set — skipping MCP handshake check" >&2
  exit 0
fi

mcp_status="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$MCP_URL" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}')"
if [ "$mcp_status" != "401" ]; then
  echo "smoke: FAILED — $MCP_URL initialize (no auth) returned $mcp_status, expected 401" >&2
  exit 1
fi
echo "smoke: OK ($MCP_URL initialize (no auth) -> 401, auth-gated)"
