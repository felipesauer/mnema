#!/usr/bin/env bash
# A DECISION SUPERSEDED, TYPED — the script the recording of a call that changes is made from.
#
# It records one decision and accepts it, prints the decisions the plugin hands the next agent
# session, then records a second decision, accepts it and has it supersede the first. The opening
# printed again carries only the second; a search finds both, the first as superseded, because a
# change of mind is a new fact and never an edit of the old one. Every command is the built
# binary, in a sandbox of its own: its own HOME, with the repository inside it, and nothing on
# the network.
#
# WHAT ON THE PAGE IS NOT THE BINARY'S OWN SPELLING, each said here:
#   - the sandbox's home is printed as `~`, so a path reads the way it would on a reader's own
#     machine rather than as a directory under the temp directory;
#   - long lines are folded at a space to fit the recording's 96 columns.
#
# HOW IT IS MADE, from the root of a built checkout (`pnpm build`):
#
#   asciinema rec --overwrite -q --cols 96 --rows 34 \
#     -c "bash recordings/a-decision-superseded.sh $PWD/packages/code/dist/cli.js" recordings/a-decision-superseded.cast
#   agg --theme github-dark --font-size 16 recordings/a-decision-superseded.cast recordings/a-decision-superseded.gif
#
# HOW IT IS HELD TO THE BINARY: packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts
# runs this same script with PACE=0 and compares what it prints with the text of the committed .cast.
set -euo pipefail

CLI=${1:?usage: a-decision-superseded.sh <absolute path to packages/code/dist/cli.js>}
case $CLI in /*) ;; *) echo "a-decision-superseded.sh: the path to cli.js must be absolute" >&2; exit 2 ;; esac

PACE=${PACE:-1}
pause() { if [ "$PACE" != 0 ]; then sleep "$1"; fi; }

export TERM=xterm-256color
export LC_ALL=C
SB=$(realpath "$(mktemp -d "${TMPDIR:-/tmp}/mnema-a-decision-superseded-XXXXXX")")
trap 'rm -rf "$SB"' EXIT
H="$SB/home"
mkdir -p "$H/your-repository"
cd "$H/your-repository"
git init -q .

mnema() { env -u MNEMA_HOME -u MNEMA_RUN HOME="$H" NO_COLOR=1 node "$CLI" "$@"; }
tilde() { sed "s|$H|~|g"; }
folded() { fold -s -w 94; }
idIn() { grep -m1 -oE '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}'; }

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
say "a repository with a record, and a call the team made and accepted"
typed "mnema init > /dev/null"
mnema init >/dev/null
typed 'mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact."'
OUT=$(mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact.")
echo "$OUT" | sed -n '1p' | tilde
OLD=$(echo "$OUT" | idIn)
typed "mnema decision move accept $OLD --note \"Agreed.\""
mnema decision move accept "$OLD" --note "Agreed." | tilde
pause 1.2

say "what the next agent session opens with"
typed "mnema brief | grep -E '^## Decisions|^- '"
mnema brief | grep -E '^## Decisions|^- ' | tilde | folded
pause 2

say "the call changes: a new decision, which supersedes the old one"
typed 'mnema decision record "Keep money as a Money of integer cents" \' \
  '"An amount never travels without its currency."'
OUT=$(mnema decision record "Keep money as a Money of integer cents" \
  "An amount never travels without its currency.")
echo "$OUT" | sed -n '1p' | tilde
NEW=$(echo "$OUT" | idIn)
typed "mnema decision move accept $NEW --note \"Agreed.\""
mnema decision move accept "$NEW" --note "Agreed." | tilde
typed "mnema decision supersede $OLD \\" \
  "$NEW --reason \"We bill in two currencies now.\""
mnema decision supersede "$OLD" "$NEW" --reason "We bill in two currencies now." | tilde | folded
pause 1.6

say "the next session opens with the call in force, and only that one"
typed "mnema brief | grep -E '^## Decisions|^- '"
mnema brief | grep -E '^## Decisions|^- ' | tilde | folded
pause 2

say "the old call is still in the record, as superseded: nothing was edited"
typed "mnema search cents"
mnema search cents | tilde | folded
pause 3
