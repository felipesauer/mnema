#!/usr/bin/env bash
# PreToolUse command hook: leaves a marker file and answers with additionalContext.
echo "fired $(date +%s)" >> "$PROBE_DIR/hook-fired.txt"
cat >/dev/null
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"HOOK_CONTEXT_MARKER_7Q2"}}'
