#!/usr/bin/env node
/**
 * The record arrives unasked: whatever `mnema brief` prints, handed to the session
 * as it opens.
 *
 * WHY THIS FILE EXISTS AT ALL, AND IT IS NOT PLUMBING. `hooks.json` could name
 * `mnema brief` directly, and that was measured before it was written: outside a
 * project the verb prints `No mnema project here. Run `mnema init` first.` on stderr
 * and exits 1. A hook wired that way injects that sentence — or an error — into EVERY
 * session of EVERY project on the machine of whoever installs this. That is the
 * product giving orders in a house that is not its own, so the muteness lives here,
 * in the plugin, and the verb stays exactly as it is: a command a person typed is a
 * command that owes that person an answer, including a refusal.
 *
 * IT NEVER BLOCKS AND NEVER FAILS LOUD. Every outcome that is not a document is
 * silence and exit 0 — no project here, no `mnema` on the PATH, a record that will
 * not read. A hook is not a place to diagnose: the session belongs to the person who
 * opened it, and `PreToolUse` — the one surface of this host that can refuse — is
 * deliberately not used by this plugin at all. Asserted in
 * `packages/code/tests/the-record-arrives-unasked.test.ts` ("says nothing at all
 * where there is no project").
 *
 * IT DECIDES NOTHING ABOUT WHAT THE AGENT READS. The document goes over BYTE FOR
 * BYTE — no preamble of ours, no framing, no cut. A second place deciding what
 * governs the work is a second place that can come to disagree with the record, and
 * the whole point of the file is that it IS the record. Asserted in the same test
 * ("hands over exactly what the verb prints").
 *
 * WHAT IT CANNOT DO, said here because the README says it to whoever installs: it
 * carries what is COMMITTED — a decision recorded `--scope private` or in the global
 * tree governs that machine's work and is not in this document — and it carries
 * NAMES, not bodies. The argument behind a decision and the text of a pattern come
 * from the agent asking, through the MCP server this same plugin declares.
 */

import { spawnSync } from 'node:child_process';

/** The event this handler answers, echoed back so the host can route the reply. */
const HOOK_EVENT = 'SessionStart';

/**
 * The command line to run.
 *
 * The `.cmd` on Windows is npm's own shim name, and it is INTENTION rather than an
 * assertion: nothing here has been run on Windows. If the guess is wrong the spawn
 * fails, and a failed spawn is silence — the plugin does nothing instead of doing
 * something wrong.
 */
const BINARY = process.platform === 'win32' ? 'mnema.cmd' : 'mnema';

/**
 * Where the session is, from the host's own environment.
 *
 * `CLAUDE_PROJECT_DIR` is the project root the host announces to every command hook.
 * Nothing is read from stdin: this handler needs no input, and a reader waiting on a
 * pipe the host may not close is a session that opens late for no gain.
 */
function whereTheSessionIs() {
  const named = process.env.CLAUDE_PROJECT_DIR;
  return named !== undefined && named !== '' ? named : process.cwd();
}

/**
 * What the record has to say here, or `null` when it has nothing.
 *
 * `null` is every silent outcome collapsed into one value, so there is ONE gate above
 * and a single place to remove if this plugin ever stopped being quiet.
 */
function theDocument(cwd) {
  const ran = spawnSync(BINARY, ['brief'], {
    cwd,
    encoding: 'utf-8',
    // stderr is dropped rather than forwarded: the refusal is addressed to a person
    // who typed a verb, and nobody typed this one.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (ran.error !== undefined || ran.status !== 0) return null;
  const document = ran.stdout ?? '';
  return document.trim() === '' ? null : document;
}

function main() {
  const document = theDocument(whereTheSessionIs());
  if (document === null) return;
  const reply = {
    hookSpecificOutput: { hookEventName: HOOK_EVENT, additionalContext: document },
  };
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}

try {
  main();
} catch {
  // Silence, deliberately and with nothing to add: the one thing this handler must
  // never do is make somebody else's session worse than it would have been without
  // the plugin installed. There is no `process.exit` here either — exiting while a
  // pipe still holds bytes is how output gets truncated.
}
