#!/usr/bin/env bash
# One attack: a fresh copy of the pristine record, the attack applied, then the product's verdict.
# Usage: run.sh <sandbox> <n> <command…>   — the command sees $SEG, $CPS, $TP and $TAIL.
set -u
W=$1; n=$2; shift 2
export HOME="$W" XDG_DATA_HOME="$W/xdg"
M="node ${MNEMA_BIN:-/home/felipe/Documents/Personal/Me/.projects/mnema/packages/code/dist/cli.js}"
d="$W/attack-$n"; rm -rf "$d"; cp -r "$W/base" "$d"; cd "$d" || exit 1
export SEG=$(ls .mnema/tails/*/000001.jsonl) CPS=$(ls .mnema/tails/*/checkpoints.jsonl)
export TP=$(ls .mnema/tails/*/tailproof.json); export TAIL=$(dirname "$SEG")
bash -c "$*" >/dev/null 2>&1
$M --color=never verify > "$W/out-$n.txt" 2>&1
printf 'attack %-3s exit=%s\n' "$n" "$?"
