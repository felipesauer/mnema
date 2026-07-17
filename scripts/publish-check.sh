#!/usr/bin/env bash
#
# Static publish-readiness gate. Runs the release inspection checks
# without actually publishing. Exits non-zero on the first failed
# check so CI / pre-publish hooks can bail.
#
# Usage:
#   bash scripts/publish-check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ok()    { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail()  { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }
step()  { printf "\n\033[1m→ %s\033[0m\n" "$1"; }

step "1. Build is fresh"
pnpm build > /dev/null 2>&1 || fail "pnpm build failed"
ok "pnpm build clean"

step "2. Lint passes"
pnpm lint > /dev/null 2>&1 || fail "pnpm lint failed"
ok "pnpm lint clean"

step "3. Test suite passes"
pnpm test > /dev/null 2>&1 || fail "pnpm test failed"
ok "pnpm test clean"

step "4. Coverage thresholds hold"
pnpm test:coverage > /dev/null 2>&1 || fail "pnpm test:coverage failed (threshold breach)"
ok "coverage gate met"

step "5. Bench budgets hold"
pnpm bench > /tmp/mnema-bench.out 2>&1 || fail "pnpm bench failed — budgets breached, see /tmp/mnema-bench.out"
ok "bench budgets met"

step "6. MCP smoke passes"
pnpm smoke:mcp > /tmp/mnema-mcp-smoke.out 2>&1 || fail "pnpm smoke:mcp failed, see /tmp/mnema-mcp-smoke.out"
ok "8 MCP tools exercised cleanly"

step "7. Tarball builds"
PACK_DIR="$(mktemp -d -t mnema-pack-XXXX)"
pnpm pack --pack-destination "$PACK_DIR" > /dev/null 2>&1 || fail "pnpm pack failed"
VERSION="$(node -p "require('./package.json').version")"
TARBALL="$PACK_DIR/felipesauer-mnema-${VERSION}.tgz"
[ -f "$TARBALL" ] || fail "tarball $TARBALL not found"
ok "tarball produced: $TARBALL"

step "8. Tarball excludes tests + bench"
LEAKED=$(tar -tzf "$TARBALL" | grep -E '\.test\.|^package/tests/|^package/bench/' || true)
[ -z "$LEAKED" ] || fail "tarball leaks dev-only files: $LEAKED"
ok "no test or bench files in tarball"

step "9. Tarball includes README + LICENSE + CHANGELOG"
TARBALL_FILES="$(tar -tzf "$TARBALL")"
for f in README.md LICENSE CHANGELOG.md; do
  if ! echo "$TARBALL_FILES" | grep -qE "^package/$f$"; then
    fail "tarball missing required file: $f"
  fi
done
ok "README + LICENSE + CHANGELOG present"

step "10. Tarball ships exactly the bundled migrations"
EXPECTED_MIGRATIONS=$(ls packages/core/src/storage/sqlite/migrations/*.sql 2>/dev/null | wc -l)
SHIPPED_MIGRATIONS=$(tar -tzf "$TARBALL" | grep -E '^package/dist/storage/sqlite/migrations/.*\.sql$' | wc -l)
if [ "$EXPECTED_MIGRATIONS" -ne "$SHIPPED_MIGRATIONS" ]; then
  fail "migration count drift: src has $EXPECTED_MIGRATIONS, tarball has $SHIPPED_MIGRATIONS"
fi
ok "$SHIPPED_MIGRATIONS migrations bundled"

step "11. Tarball ships the 4 workflows"
WORKFLOWS=$(tar -tzf "$TARBALL" | grep -E '^package/workflows/.*\.json$' | wc -l)
if [ "$WORKFLOWS" -ne 4 ]; then
  fail "expected 4 workflows in tarball, got $WORKFLOWS"
fi
ok "4 workflows bundled (default, lean, kanban, jira-classic)"

step "12. package.json publishConfig is public"
ACCESS="$(node -p "require('./package.json').publishConfig?.access ?? 'missing'")"
if [ "$ACCESS" != "public" ]; then
  fail "publishConfig.access is '$ACCESS', expected 'public' (scope @felipesauer needs it)"
fi
ok "publishConfig.access = public"

step "13. Production resolver works from outside the source tree"
ISOLATED="$(mktemp -d -t mnema-publish-check-XXXX)"
trap 'rm -rf "$ISOLATED" "$PACK_DIR"' EXIT
(
  cd "$ISOLATED"
  node "$REPO_ROOT/packages/mnema/dist/index.js" --version > /dev/null 2>&1 \
    || fail "compiled binary fails --version outside the repo"
  node "$REPO_ROOT/packages/mnema/dist/index.js" init --name "Publish Check" --key "PUBCHK" > /dev/null 2>&1 \
    || fail "compiled binary fails init outside the repo (migration resolver broken?)"
  MNEMA_ACTOR=publish-check node "$REPO_ROOT/packages/mnema/dist/index.js" doctor > /dev/null 2>&1 \
    || fail "compiled binary fails doctor on a fresh project outside the repo"
)
ok "compiled CLI runs init + doctor from an isolated directory"

printf "\n\033[1;32mAll publish-readiness checks passed for v%s\033[0m\n" "$VERSION"
printf "Next step: run the manual publish smoke in a tmpdir\n"
printf "          (init → task create → task move → doctor)\n"
printf "Then: npm publish %s --tag alpha\n" "$TARBALL"
