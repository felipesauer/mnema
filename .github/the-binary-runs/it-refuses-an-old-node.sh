#!/usr/bin/env bash
# Runs the BUILT binary under whatever Node is first on the PATH, which the caller has put BELOW
# the floor, and requires the refusal and nothing else: exit 1, nothing on stdout, and on stderr
# the one sentence the floor writes. No `ExperimentalWarning` before it, no stack trace instead.
#
# Why this is a script run on a real old Node and not a test run by the suite: the suite runs on a
# Node that has `node:sqlite`, and a Node that has it cannot show what a Node that lacks it does.
# The module graph is linked before the first line of the first module runs, so a guard that is
# merely the first import of an entry that links the whole program speaks after the link has
# failed (a Node before 22.13 throws `ERR_UNKNOWN_BUILTIN_MODULE`) or after the builtin has warned
# (a 24 before 24.15 prints `ExperimentalWarning: SQLite is an experimental feature`).
#
# Usage: it-refuses-an-old-node.sh [path to the built entry]
set -u

entry="${1:-packages/code/dist/cli.js}"
running="$(node --version)"
running="${running#v}"
home="$(mktemp -d)"
out="$(mktemp)"
err="$(mktemp)"

HOME="$home" node "$entry" --version >"$out" 2>"$err"
status=$?

echo "node ${running}: exit ${status}"
echo "stdout: $(cat "$out")"
echo "stderr:"
cat "$err"

failed=0
fail() {
  echo "FAIL: $1"
  failed=1
}

[ "$status" -eq 1 ] || fail "expected exit 1"
[ ! -s "$out" ] || fail "expected nothing on stdout"
[ "$(wc -l <"$err")" -eq 1 ] || fail "expected exactly one line on stderr"
grep -q "^mnema needs Node .*; this is Node ${running}\. " "$err" || fail "expected the floor's sentence for Node ${running}"
if grep -Eq "ExperimentalWarning|Error|node:internal|^\s+at " "$err"; then
  fail "stderr carries a warning or a trace"
fi

exit "$failed"
