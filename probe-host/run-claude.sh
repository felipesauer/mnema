#!/usr/bin/env bash
# One claude session against the fake API. Meant to run INSIDE a network namespace that holds
# only loopback. usage: run-claude.sh <claude-binary> <out-dir>
set -u
CLAUDE=$(readlink -f "$1"); OUT=$(readlink -f "$2")
H=$(dirname "$(readlink -f "$0")")
mkdir -p "$OUT/home/.claude" "$OUT/project/.claude"
ip link set lo up 2>/dev/null || true
echo "== interfaces in this namespace"; ip -br addr 2>&1 || cat /proc/net/dev
echo "== control: reaching the outside must fail"
curl -sS -m 5 -o /dev/null https://example.com 2>&1 | sed 's/^/example.com: /'
curl -sS -m 5 -o /dev/null http://1.1.1.1 2>&1 | sed 's/^/1.1.1.1: /'
PORT=$((47000 + RANDOM % 900))
KEY="sk-ant-api03-probe-0000000000000000000000000000"; LAST20=${KEY: -20}
cat >"$OUT/home/.claude/.claude.json" <<JSON
{"hasCompletedOnboarding":true,"bypassPermissionsModeAccepted":true,"customApiKeyResponses":{"approved":["$LAST20"],"rejected":[]},"projects":{"$OUT/project":{"hasTrustDialogAccepted":true,"hasCompletedProjectOnboarding":true}}}
JSON
cat >"$OUT/project/.claude/settings.json" <<JSON
{"permissions":{"allow":["Write"]},"hooks":{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"bash $H/hook.sh"}]}]}}
JSON
PROBE_WRITE_PATH="$OUT/project/written.txt" node "$H/fake-api.mjs" "$PORT" "$OUT/api-requests.json" >"$OUT/api-stdout.txt" 2>&1 &
API=$!; sleep 1
cd "$OUT/project" || exit 1
STRACE=""
command -v strace >/dev/null && STRACE="strace -f -qq -e trace=connect,sendto,sendmsg -s 120 -o $OUT/connect.strace"
# shellcheck disable=SC2086
env -i HOME="$OUT/home" PATH=/usr/bin:/bin TERM=dumb LANG=C.UTF-8 USER=probe \
  CLAUDE_CONFIG_DIR="$OUT/home/.claude" ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_API_KEY="$KEY" \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_UPDATES=1 DISABLE_AUTOUPDATER=1 \
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 \
  DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 DISABLE_BUG_COMMAND=1 \
  PROBE_DIR="$OUT" \
  timeout 120 $STRACE "$CLAUDE" -p "Say hi." --model claude-sonnet-4-5 --output-format stream-json --verbose --include-hook-events --debug-file "$OUT/debug.txt" \
  >"$OUT/stream.jsonl" 2>"$OUT/stderr.txt"
echo "claude exit=$?" | tee "$OUT/exit.txt"
kill "$API" 2>/dev/null; wait 2>/dev/null
