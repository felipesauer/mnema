#!/usr/bin/env bash
#
# Resets /tmp/mnema-smoke/ so the manual smoke suite documented at
# docs/SMOKE.md can start from a clean slate. Idempotent: re-running
# wipes any previous run.
#
# Usage:
#   bash scripts/smoke-bootstrap.sh
#
# Prerequisites: `pnpm build` and `npm i -g ./saurim-mnema-*.tgz`
# (or `npm link`) so `mnema --version` resolves the build under test.

set -euo pipefail

SMOKE_DIR="${SMOKE_DIR:-/tmp/mnema-smoke}"

if [ -d "$SMOKE_DIR" ]; then
  echo "→ wiping existing $SMOKE_DIR"
  rm -rf "$SMOKE_DIR"
fi

mkdir -p "$SMOKE_DIR"

echo "✓ smoke workdir ready at $SMOKE_DIR"
echo "  cd $SMOKE_DIR"
if command -v mnema >/dev/null 2>&1; then
  echo "  mnema --version → $(mnema --version)"
else
  echo "  ⚠ \`mnema\` is not on PATH — run \`pnpm build && pnpm pack && npm i -g ./saurim-mnema-*.tgz\` first"
fi
echo ""
echo "Open docs/SMOKE.md and follow Phase 1 onwards."
