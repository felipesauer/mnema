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
 * product speaking where it has nothing to say — a project with no record has no
 * decision and no pattern to cite, and mnema's rules are its RECORD's rules — so the
 * muteness lives here, in the plugin, and the verb stays exactly as it is: a command a
 * person typed is a command that owes that person an answer, including a refusal.
 *
 * THIS HANDLER NEVER BLOCKS AND NEVER FAILS LOUD, AND THAT IS STILL TRUE. Every
 * outcome that is not a document is silence and exit 0 — no project here, no `mnema`
 * on the PATH, a record that will not read. A hook is not a place to diagnose: the
 * session belongs to the person who opened it, and a diagnosis nobody asked for buys
 * nothing. Asserted in `packages/code/tests/the-record-arrives-unasked.test.ts`
 * ("says nothing at all where there is no project").
 *
 * THE REASON THAT USED TO STAND HERE IS FALSE — rewritten rather than deleted, because
 * it was read as doctrine and became one. It said: "`PreToolUse` — the one surface of
 * this host that can refuse — is deliberately not used by this plugin at all",
 * offered as a property of the PRODUCT rather than a fact about this file. Three
 * things falsified it on 18 Aug 2026: mnema's own foundation never said it and says
 * the opposite (the agents "execute behind workflow gates"); the product already
 * refuses with 44 distinct typed codes of its own (counted 18 Aug 2026 across the
 * refusal-code unions and `code:` literals of the three packages' source); and a
 * round scored
 * the arm carrying the record at 0/8 on the two tasks that discriminate — what the arm
 * carrying NO record scored — against 8/8 for an arm that injected the same knowledge
 * unasked. The foundation now says mnema governs the work with proof, under six ties
 * (G1-G6). None of that is in this file, and none of it changes a byte of it: the
 * event set lives in `hooks.json` and it names ONE event, which is what the case
 * "runs `mnema brief`, and nothing else" holds.
 *
 * IT DECIDES NOTHING ABOUT WHAT THE AGENT READS. The document goes over BYTE FOR
 * BYTE — no preamble of ours, no cut. A second place deciding what GOVERNS the work is
 * a second place that can come to disagree with the record, and the whole point of the
 * file is that it IS the record. Asserted in the same test ("hands over exactly what
 * the verb prints").
 *
 * There is no framing either, and G6 of the foundation narrows what that is worth: a
 * channel that pushes record text to a MODEL should say what the text IS, because
 * saying what it is is provenance, not a second opinion about what governs. The
 * byte-for-byte argument covers the cut and the preamble; it never covered provenance,
 * and it was read as if it did. Nothing changes here today — this channel pushes the
 * NAMES that `brief` already labels — and the day it carries rule bodies is the day
 * framing belongs in it.
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
