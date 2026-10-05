#!/usr/bin/env bash
# THE FIRST RECORD, TYPED — the script the recording on the front page is made from.
#
# It founds a record in an empty repository, writes down one decision with the option it turned
# down, accepts it, prints the decisions the plugin hands the next agent session, and verifies.
# Every command is the built binary, in a sandbox of its own: its own HOME, with the repository
# inside it, and nothing on the network.
#
# TWO THINGS ON THE PAGE ARE NOT THE BINARY'S OWN SPELLING, and both are said here:
#   - the sandbox's home is printed as `~`, so a path reads the way it would on a reader's own
#     machine rather than as a directory under the temp directory;
#   - `verify`'s lines are folded at a space to fit the recording's 96 columns, where the
#     terminal would otherwise cut them in the middle of a word.
#
# HOW IT IS MADE, from the root of a built checkout (`pnpm build`):
#
#   asciinema rec --overwrite -q --cols 96 --rows 34 \
#     -c "bash recordings/first-record.sh $PWD/packages/code/dist/cli.js" recordings/first-record.cast
#   agg --theme github-dark --font-size 16 recordings/first-record.cast recordings/first-record.gif
#
# HOW IT IS HELD TO THE BINARY: packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts
# runs this same script with PACE=0 — every pause and every per-character delay skipped, the
# text unchanged — and compares what it prints with the text of the committed .cast, so a change
# to anything the binary prints turns that case red until the recording is made again.
set -euo pipefail

CLI=${1:?usage: first-record.sh <absolute path to packages/code/dist/cli.js>}
case $CLI in /*) ;; *) echo "first-record.sh: the path to cli.js must be absolute" >&2; exit 2 ;; esac

# PACE=0 is the case's pace: the same text, with nothing waited for.
PACE=${PACE:-1}
pause() { if [ "$PACE" != 0 ]; then sleep "$1"; fi; }

export TERM=xterm-256color
# One byte, one column, for every tool the script pipes through: `fold` counts bytes where coreutils
# is built without multibyte support and characters where it is built with it, and the `—` in
# `verify`'s lines is three bytes, so an unpinned locale folds the same output two ways.
export LC_ALL=C
SB=$(realpath "$(mktemp -d "${TMPDIR:-/tmp}/mnema-first-record-XXXXXX")")
trap 'rm -rf "$SB"' EXIT
H="$SB/home"
mkdir -p "$H/your-repository"
cd "$H/your-repository"
git init -q .

mnema() { env -u MNEMA_HOME -u MNEMA_RUN HOME="$H" NO_COLOR=1 node "$CLI" "$@"; }
tilde() { sed "s|$H|~|g"; }

# A command line, typed: the prompt, then one character at a time, and a continuation line for
# each further argument group, the way a person breaks a long command.
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
say "an empty repository, and nothing on the network"
typed "mnema init"
mnema init | tilde
pause 1.6

say "write down a call, with the reasoning and what was turned down"
typed 'mnema decision record "Keep money as integer cents" \' \
  '"Float sums drift; cents are exact." \' \
  '--alternatives "A decimal library: slower, one more dependency."'
OUT=$(mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact." \
  --alternatives "A decimal library: slower, one more dependency.")
echo "$OUT" | tilde
ID=$(echo "$OUT" | grep -m1 -oE '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}')
pause 1.6

typed "mnema decision move accept $ID --note \"Agreed in review.\""
mnema decision move accept "$ID" --note "Agreed in review." | tilde
pause 1.6

say "the decisions the plugin hands the next agent session as it opens"
typed "mnema brief | sed -n '/Decisions in force/,/^- /p'"
mnema brief | sed -n '/Decisions in force/,/^- /p' | tilde
pause 2.2

say "and what the record can prove about itself — no key, no network"
typed "mnema verify"
mnema verify | fold -s -w 94 | tilde
pause 3
