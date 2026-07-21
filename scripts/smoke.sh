#!/usr/bin/env bash
# Post-deploy smoke check (pipeline step; docs/spec/11-testing-strategy.md §6).
# Usage: PROD_URL=https://atlas-....vercel.app bun run smoke
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
