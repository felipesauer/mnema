#!/usr/bin/env bash
# The A/B: the product as it is, against the product with the fold's reader answering
# "nothing carried proof" — the state it was in before this slice.
#
# The arms are BUILT ONCE and swapped IN PLACE, because a dist copied outside the
# workspace cannot resolve `@mnema/chain` (the resolution is the workspace's symlinks).
# Alternating, because a machine drifts. A CONTROL of the same build against itself,
# because two numbers that differ are only a finding if identical work ties.
#
# It leaves the tree as it found it: the source is restored and the product rebuilt.
set -u
ROOT=/home/felipe/Documents/Personal/Me/.projects/mnema
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK=$(mktemp -d /tmp/mnema-proof-cost-XXXXXX)
MOVES=${1:-2000}
N=${2:-7}
BARE=${3:-}
PROOF=$ROOT/packages/core/src/projections/proof.ts
cd "$ROOT"
trap 'cp "$WORK/proof.ts.bak" "$PROOF" 2>/dev/null; pnpm build > /dev/null 2>&1; rm -rf "$WORK"' EXIT

save() { for p in chain core; do mkdir -p "$WORK/$1/$p"; cp -r "packages/$p/dist" "$WORK/$1/$p/dist"; done; }
install_arm() { for p in chain core; do rm -rf "packages/$p/dist"; cp -r "$WORK/$1/$p/dist" "packages/$p/dist"; done; }

pnpm build > /dev/null 2>&1
save with
cp "$PROOF" "$WORK/proof.ts.bak"
python3 - "$PROOF" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "  const said = transitionProse(event.payload.fields);"
new = "  const said = transitionProse(undefined);"
assert old in s, 'ANCHOR ABSENT — the arm was never built'
open(p, 'w').write(s.replace(old, new, 1))
PY
if [ $? -ne 0 ]; then echo "RULER BROKEN (anchor absent)"; exit 1; fi
pnpm build > /dev/null 2>&1
save without
cp "$WORK/proof.ts.bak" "$PROOF"

REC=$WORK/record
WHAT=$([ -n "$BARE" ] && echo "none carrying anything" || echo "every one carrying prose")
echo "=== $MOVES moves, $WHAT; median of $N rebuilds per process ==="
for r in 1 2 3 4; do
  if [ $((r % 2)) -eq 1 ]; then A=with; B=without; else A=without; B=with; fi
  install_arm "$A"; a=$(node "$HERE/rebuild.mjs" "$REC" "$MOVES" "$N" "$BARE" 2>/dev/null)
  install_arm "$B"; b=$(node "$HERE/rebuild.mjs" "$REC" "$MOVES" "$N" "$BARE" 2>/dev/null)
  echo "round $r: $A=$a ms   $B=$b ms"
done
echo "=== CONTROL: the same build against itself — identical work has to tie ==="
for r in 1 2; do
  install_arm with; a=$(node "$HERE/rebuild.mjs" "$REC" "$MOVES" "$N" "$BARE" 2>/dev/null)
  install_arm with; b=$(node "$HERE/rebuild.mjs" "$REC" "$MOVES" "$N" "$BARE" 2>/dev/null)
  echo "control $r: with=$a ms   with=$b ms"
done
install_arm with
