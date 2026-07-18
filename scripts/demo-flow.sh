#!/usr/bin/env bash
#
# The canonical Mnema demo: init → drive a task through the workflow →
# review/approve → doctor proves the chain → a tamper is caught.
#
# Single source of truth for the demo, used two ways:
#   - `scripts/record-quickstart.sh` runs it under `asciinema rec` (a human
#     records a real terminal, best timing).
#   - `scripts/make-cast.mjs` runs it and synthesises a .cast from the real
#     command output (no live recording needed; reproducible in CI).
#
# It expects `mnema` on PATH and a clean CWD, and drives a throwaway
# project. Every command is real — the .cast is not staged screen fiction.

set -e

step() {
  echo
  echo "# $1"
  sleep 1.2
}

step "1. Initialise a project — one tamper-evident audit log, workflow gates"
mnema init --yes --name "Payments API" --key PAY
sleep 1

step "2. An agent captures a task and drives it through the workflow"
mnema task create --title "Add rate limiting"
mnema task move PAY-1 submit \
  --field title="Add rate limiting" \
  --field description="Throttle auth to 100 req/min" \
  --field acceptance_criteria="429 on excess,headers set" \
  --field estimate=3
mnema task move PAY-1 start --field assignee_id=you
sleep 1

step "3. You review and approve — the agent cannot route around the gate"
mnema task move PAY-1 submit_review
mnema task move PAY-1 approve
sleep 1

step "4. doctor verifies the hash-chained audit log end to end"
mnema doctor
sleep 2

step "5. Now tamper: rewrite who did the work in a past audit line…"
# Each machine writes its own tail (audit/m-<id>/); tamper the one on disk.
# Kept to ONE command so the cast renderer (which runs each line in a fresh
# shell) resolves the glob and edits in the same process.
sed -i.bak '0,/"actor":"you"/s//"actor":"mallory"/' .mnema/audit/m-*/current.jsonl && rm -f .mnema/audit/m-*/current.jsonl.bak && echo "(edited the on-disk audit tail by hand)"
sleep 1.5

step "6. …and doctor catches it. The record can't be quietly altered."
mnema doctor || true
sleep 2.5
