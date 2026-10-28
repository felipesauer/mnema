#!/usr/bin/env bash
# A TAMPER CAUGHT, TYPED: the script the recording of a changed word and a failing `verify` is made
# from.
#
# It records one decision, accepts it, and runs `mnema verify`: a green line. Then it changes one
# word of that decision in the record's own file, by hand, with `sed`, and runs `mnema verify`
# again: the verdict is red, it names the event whose hash no longer matches, and the exit code is
# 1. Every command is the built binary, in a sandbox of its own: its own HOME, with the
# repository inside it, and nothing on the network.
#
# THE EDIT IS DONE BY THIS SCRIPT, WITH `sed`, AND IT IS THE WHOLE ACT: `verify` does not know who
# edited the file, or why, and does not say. It says only that the event in the file is not the
# event that was signed.
#
# WHAT ON THE PAGE IS NOT THE BINARY'S OWN SPELLING, each said here:
#   - the sandbox's home is printed as `~`, so a path reads the way it would on a reader's own
#     machine rather than as a directory under the temp directory;
#   - the first `verify` is cut to its first line, the verdict, so the red one fits the screen;
#   - long lines are folded at a space to fit the recording's 96 columns, and the name of the tail
#     in an issue, 97 characters with no space in it, is shown as its first eight characters and
#     three dots, since folded it would be cut across three lines;
#   - the exit code is the one the binary returned, read into the script and printed by an `echo`
#     typed after it: the script itself leaves with 0.
#
# HOW IT IS MADE, from the root of a built checkout (`pnpm build`):
#
#   asciinema rec --overwrite -q --cols 96 --rows 34 \
#     -c "bash recordings/a-tamper-caught.sh $PWD/packages/code/dist/cli.js" recordings/a-tamper-caught.cast
#   agg --theme github-dark --font-size 16 recordings/a-tamper-caught.cast recordings/a-tamper-caught.gif
#
# HOW IT IS HELD TO THE BINARY: packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts
# runs this same script with PACE=0 and compares what it prints with the text of the committed .cast.
set -euo pipefail

CLI=${1:?usage: a-tamper-caught.sh <absolute path to packages/code/dist/cli.js>}
case $CLI in /*) ;; *) echo "a-tamper-caught.sh: the path to cli.js must be absolute" >&2; exit 2 ;; esac

PACE=${PACE:-1}
pause() { if [ "$PACE" != 0 ]; then sleep "$1"; fi; }

export TERM=xterm-256color
export LC_ALL=C
SB=$(realpath "$(mktemp -d "${TMPDIR:-/tmp}/mnema-a-tamper-caught-XXXXXX")")
trap 'rm -rf "$SB"' EXIT
H="$SB/home"
mkdir -p "$H/your-repository"
cd "$H/your-repository"
git init -q .

mnema() { env -u MNEMA_HOME -u MNEMA_RUN HOME="$H" NO_COLOR=1 node "$CLI" "$@"; }
tilde() { sed "s|$H|~|g"; }
folded() { fold -s -w 94; }
# A tail's name is a 64-digit hash, a dash and 32 more digits: it is shown as its first eight.
shortened() { sed -E 's/([0-9a-f]{8})[0-9a-f]{56}-[0-9a-f]{32}#/\1...#/'; }

typed() {
  local first=1 line i
  for line in "$@"; do
    if [ $first = 1 ]; then printf '\033[1m$\033[0m '; first=0; else printf '    '; fi
    if [ "$PACE" = 0 ]; then
      printf '%s' "$line"
    else
      for ((i = 0; i < ${#line}; i++)); do printf '%s' "${line:$i:1}"; sleep 0.025; done
    fi
    printf '\n'
  done
  pause 0.4
}
say() { printf '\033[2m# %s\033[0m\n' "$1"; pause 0.8; }

printf '\033[2J\033[H'
say "a repository with a record, and a call the team made"
# `init` is typed with --all-hosts: it asks which host files to write when a person is at the terminal, and
# this recording is one, so the option is what keeps the recording from stopping at the question.
typed "mnema init --all-hosts > /dev/null"
mnema init --all-hosts >/dev/null
typed 'mnema decision record "Keep money as integer cents" \' \
  '"Float sums drift; cents are exact."'
OUT=$(mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact.")
echo "$OUT" | tilde
ID=$(grep -m1 -oE '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$OUT")
pause 1.2

typed "mnema decision move accept $ID --note \"Agreed in review.\""
mnema decision move accept "$ID" --note "Agreed in review." | tilde
pause 1.2

say "the record checks out"
typed "mnema verify"
mnema verify | sed -n '1p' | folded | tilde
pause 2

say "someone changes one word of the decision, by hand, in the record's file"
typed "sed -i 's/sums drift/sums agree/' .mnema/tails/*/000001.jsonl"
sed -i 's/sums drift/sums agree/' .mnema/tails/*/000001.jsonl
pause 1.6

say "the same check, on the same record"
typed "mnema verify"
set +e
VERDICT=$(mnema verify 2>&1)
CODE=$?
set -e
echo "$VERDICT" | tilde | shortened | folded
pause 2.4
typed 'echo "exit $?"'
echo "exit $CODE"
pause 3
