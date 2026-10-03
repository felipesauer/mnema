#!/usr/bin/env bash
# The whole matrix, base · head · head · base for every wall at 10k, 30k and 100k.
set -u
S="$MEASURE_DIR"; HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$S/matrix.jsonl}"
for N in 10000 30000 100000; do
  bash "$HERE/ab.sh" $N refresh1 4 "$OUT"
  bash "$HERE/ab.sh" $N cli-search 5 "$OUT"
  bash "$HERE/ab.sh" $N cli-brief 5 "$OUT"
  bash "$HERE/ab.sh" $N cli-recall 5 "$OUT"
  bash "$HERE/ab.sh" $N cli-decision-record 4 "$OUT"
  bash "$HERE/ab.sh" $N cli-task-move 4 "$OUT"
  bash "$HERE/ab.sh" $N cli-decision-move 4 "$OUT"
  bash "$HERE/ab.sh" $N census 7 "$OUT"
  bash "$HERE/ab.sh" $N linkbreaks 1 "$OUT"
  bash "$HERE/ab.sh" $N busy 3 "$OUT"
done
bash "$HERE/ab.sh" 10000 floor 60 "$OUT"
echo finished >> "$OUT.done"
