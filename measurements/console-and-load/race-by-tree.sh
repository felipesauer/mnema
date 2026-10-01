#!/usr/bin/env bash
# . Two concurrent `decision` writes into a fresh tail of ONE tree, N times, in a sandbox each.
#   race-by-tree.sh <repo-root> <public|private|global> <N> [label]
# Counts per run: verify failed (broke), fewer than two titles on the tail (lost), a writer exited
# non-zero (refused). The HOME of every run is an absolute sandbox; nothing touches the real one.
set -u
REPO=$1; TREE=$2; N=${3:-20}; LABEL=${4:-$TREE}
CLI="node $REPO/packages/code/dist/cli.js --color=never"
if $CLI decision --help 2>&1 | grep -q 'record \[options\]'; then REC="decision record"; else REC="decision"; fi
SCOPE=""; [ "$TREE" != public ] && SCOPE="--scope $TREE"
broke=0; lost=0; refused=0
for i in $(seq 1 "$N"); do
  SB=$(mktemp -d)
  export HOME="$SB/home" XDG_DATA_HOME="$SB/data" GIT_CONFIG_NOSYSTEM=1
  case "$HOME" in /*) ;; *) echo "HOME is not absolute"; exit 2;; esac
  mkdir -p "$HOME" "$SB/p"; unset MNEMA_RUN MNEMA_HOME
  cd "$SB/p" && git init -q . && $CLI init >/dev/null 2>&1
  $CLI $REC $SCOPE Base antes >/dev/null 2>&1
  ( $CLI $REC $SCOPE "A$i" concorrente >"$SB/a.out" 2>&1; echo $? >"$SB/a.rc" ) &
  ( $CLI $REC $SCOPE "B$i" concorrente >"$SB/b.out" 2>&1; echo $? >"$SB/b.rc" ) &
  wait
  $CLI verify --global >"$SB/v.out" 2>&1; rc=$?
  case $TREE in
    public) T="$SB/p/.mnema/tails" ;;
    private) T="$SB/p/.mnema/private/tails" ;;
    # the global tree moved from $XDG_DATA_HOME/mnema/global (older builds) to $HOME/.mnema/global
    global) T="$HOME/.mnema/global/tails $XDG_DATA_HOME/mnema/global/tails" ;;
  esac
  titles=$(for d in $T; do cat "$d"/*/0*.jsonl 2>/dev/null; done | grep -c "\"title\":\"[AB]$i\"" || true)
  [ "$rc" -ne 0 ] && broke=$((broke+1))
  [ "$titles" -lt 2 ] && lost=$((lost+1))
  if [ "$(cat "$SB/a.rc")" -ne 0 ] || [ "$(cat "$SB/b.rc")" -ne 0 ]; then refused=$((refused+1)); fi
  cd /; rm -rf "$SB"
done
echo "$LABEL tree=$TREE N=$N broke=$broke lost=$lost refused=$refused"
