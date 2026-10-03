#!/usr/bin/env bash
# usage: MEASURE_DIR=… HEAD_WT=… make-fixture.sh <N>   — a frozen synthetic record of N events, founded by `mnema init`.
set -euo pipefail
N="$1"
S="$MEASURE_DIR"; WT="$HEAD_WT"; HERE="$(cd "$(dirname "$0")" && pwd)"
SB="$S/fx/$N"
[ -e "$SB" ] && { chmod -R u+w "$SB"; rm -rf "$SB"; }
mkdir -p "$SB/proj" "$SB/home"
( cd "$SB/proj" && env -i HOME="$SB/home" PATH="$PATH" GIT_CONFIG_NOSYSTEM=1 git init -q . \
  && env -i HOME="$SB/home" PATH="$PATH" GIT_CONFIG_NOSYSTEM=1 node "$WT/packages/code/dist/cli.js" init > /dev/null )
SANDBOX_HOME="$SB/home"
GEN_WT="$WT" node "$HERE/make-record.mjs" "$SB/proj" "$SANDBOX_HOME/.mnema/identity" "$N" 42 > "$SB/gen.json"
du -sb "$SB/proj/.mnema" | cut -f1 > "$SB/bytes"
echo "$N $(cat "$SB/bytes") $(cut -c1-200 "$SB/gen.json")"
