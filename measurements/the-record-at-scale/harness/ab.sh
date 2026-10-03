#!/usr/bin/env bash
# usage: ab.sh <N> <op> <reps> <out-file>   — base · head · head · base, same load, appended as JSON lines.
set -u
N="$1"; OP="$2"; REPS="$3"; OUT="$4"
# MEASURE_DIR: fixtures and scratch. BASE_WT / HEAD_WT: two built checkouts, the trunk and the branch.
S="$MEASURE_DIR"; BASE="$BASE_WT"; HEAD="$HEAD_WT"
HERE="$(cd "$(dirname "$0")" && pwd)"
for wt in "$BASE" "$HEAD" "$HEAD" "$BASE"; do
  node "$HERE/measure.mjs" "$wt" "$N" "$OP" "$REPS" >> "$OUT" 2>> "$OUT.err" || echo "{\"wt\":\"$wt\",\"N\":$N,\"op\":\"$OP\",\"failed\":true}" >> "$OUT"
done
