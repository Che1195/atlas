#!/usr/bin/env bash
# Subject-scoping invariant lint (docs/spec/08-security-model.md §2).
# Public Convex functions live in files directly under convex/ — none of them
# may accept a userId argument from the client. Internal functions (convex/internal/,
# convex/ai/) take userId explicitly and are exempt.
set -euo pipefail
cd "$(dirname "$0")/.."

violations=0

for f in convex/*.ts; do
  base="$(basename "$f")"
  case "$base" in
    schema.ts|auth.config.ts|http.ts) continue ;;
  esac
  if grep -n 'userId[[:space:]]*:[[:space:]]*v\.' "$f"; then
    echo "INVARIANT VIOLATION: $f declares a client-supplied userId arg (see convex/lib/auth.ts header)" >&2
    violations=1
  fi
done

# The two sanctioned v.any() live in schema.ts (revisions.snapshot, proposals.ops).
# Any other v.any() needs an ADR (docs/spec/04 §notes).
any_count="$(grep -c 'v\.any()' convex/schema.ts || true)"
if [ "$any_count" -gt 2 ]; then
  echo "INVARIANT VIOLATION: convex/schema.ts has $any_count v.any() occurrences (2 sanctioned)" >&2
  violations=1
fi
if grep -rn 'v\.any()' convex --include='*.ts' \
  --exclude-dir=_generated | grep -v '^convex/schema.ts:'; then
  echo "INVARIANT VIOLATION: v.any() outside schema.ts requires an ADR" >&2
  violations=1
fi

if [ "$violations" -ne 0 ]; then
  exit 1
fi
echo "invariants: OK"
