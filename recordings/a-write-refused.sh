#!/usr/bin/env bash
# A WRITE REFUSED, TYPED — the script the recording of a rule that refuses an agent's write is made
# from.
#
# It records one decision, accepts it, links it to `src/billing` as a rule that refuses a write
# there, and then runs what the plugin's hook runs before VS Code's agent writes a file under it:
# the reply is a refusal, citing the rule. Every command is the built binary, in a sandbox of its
# own: its own HOME, with the repository inside it, and nothing on the network.
#
# WHAT ON THE PAGE IS NOT THE BINARY'S OWN SPELLING, each said here:
#   - the sandbox's home is printed as `~`, so a path reads the way it would on a reader's own
#     machine rather than as a directory under the temp directory;
#   - the payload the host hands its hook is written by this script, in the shape VS Code hands
#     it for a `create_file` (the shape the suite's own case for that host uses), and `jq` prints
#     the two fields of the reply the host reads, one to a line;
#   - long lines are folded at a space to fit the recording's 96 columns.
#
# HOW IT IS MADE, from the root of a built checkout (`pnpm build`):
#
#   asciinema rec --overwrite -q --cols 96 --rows 34 \
#     -c "bash recordings/a-write-refused.sh $PWD/packages/code/dist/cli.js" recordings/a-write-refused.cast
#   agg --theme github-dark --font-size 16 recordings/a-write-refused.cast recordings/a-write-refused.gif
#
# HOW IT IS HELD TO THE BINARY: packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts
# runs this same script with PACE=0 and compares what it prints with the text of the committed .cast.
set -euo pipefail

CLI=${1:?usage: a-write-refused.sh <absolute path to packages/code/dist/cli.js>}
case $CLI in /*) ;; *) echo "a-write-refused.sh: the path to cli.js must be absolute" >&2; exit 2 ;; esac
command -v jq >/dev/null || { echo "a-write-refused.sh: jq is not on the PATH" >&2; exit 2; }

PACE=${PACE:-1}
pause() { if [ "$PACE" != 0 ]; then sleep "$1"; fi; }

export TERM=xterm-256color
export LC_ALL=C
SB=$(realpath "$(mktemp -d "${TMPDIR:-/tmp}/mnema-a-write-refused-XXXXXX")")
trap 'rm -rf "$SB"' EXIT
H="$SB/home"
mkdir -p "$H/your-repository"
cd "$H/your-repository"
git init -q .

mnema() { env -u MNEMA_HOME -u MNEMA_RUN HOME="$H" NO_COLOR=1 node "$CLI" "$@"; }
tilde() { sed "s|$H|~|g"; }
folded() { fold -s -w 94; }

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

# What VS Code hands the plugin's hook before its agent creates a file.
printf '{"hook_event_name":"PreToolUse","tool_name":"create_file","tool_input":{"filePath":"%s","content":"export const total = 0.1 + 0.2;\\n"},"cwd":"%s"}\n' \
  "$PWD/src/billing/invoice.ts" "$PWD" >"$SB/create_file.json"

printf '\033[2J\033[H'
say "a repository with a record, and a call the team made"
typed "mnema init > /dev/null"
mnema init >/dev/null
typed 'mnema decision record "Keep money as integer cents" \' \
  '"Float sums drift; cents are exact."'
OUT=$(mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact.")
echo "$OUT" | tilde
ID=$(echo "$OUT" | grep -m1 -oE '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}')
pause 1.2

typed "mnema decision move accept $ID --note \"Agreed in review.\""
mnema decision move accept "$ID" --note "Agreed in review." | tilde
pause 1.2

say "address it at the code it governs, as a rule that refuses a write there"
typed "mnema link $ID src/billing --rel refuses-a-write"
mnema link "$ID" src/billing --rel refuses-a-write | tilde | folded
pause 1.6

say "the agent is about to write src/billing/invoice.ts; the plugin's hook asks first"
typed "mnema before-a-write --host vscode < create_file.json \\" \
  "| jq -r '.hookSpecificOutput | .permissionDecision, .permissionDecisionReason'"
mnema before-a-write --host vscode <"$SB/create_file.json" |
  jq -r '.hookSpecificOutput | .permissionDecision, .permissionDecisionReason' | tilde | folded
pause 2.4

say "the refusal is a signed fact of the record, like the rule it cites"
typed "mnema verify"
mnema verify | sed -n '1p' | folded | tilde
pause 3
