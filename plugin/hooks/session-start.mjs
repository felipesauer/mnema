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
 * refusal-code unions and `code:` literals of this workspace's non-test source); and a
 * round scored the arm carrying the record at 0/8 on the two tasks that discriminate —
 * what the arm carrying NO record scored — against 8/8 for an arm that injected the
 * same knowledge unasked. The foundation now says mnema governs the work with proof,
 * under six ties (G1-G6). None of that is in this file, and none of it changes a byte
 * of it: the event set lives in `hooks.json` and it names ONE event, which is what the
 * case "runs `mnema brief`, and nothing else" holds.
 *
 * IT DECIDES NOTHING ABOUT WHAT THE AGENT READS. The document goes over BYTE FOR
 * BYTE — no preamble of THIS FILE's, no cut. A second place deciding what governs the
 * work is a second place that can come to disagree with the record, and the whole
 * point of the file is that it IS the record. Asserted in the same test ("hands over
 * exactly what the verb prints").
 *
 * IT IS A CHANNEL, AND THE CHANNEL IS DECLARED — {@link MODEL_CHANNEL}. This line used
 * to read "no framing", which was true of what this handler ADDS and was read as a
 * claim that the text arrives at the model undeclared. It does not: the document says
 * whose text it carries in its own first lines, decided where it is composed
 * (`packages/code/src/record-framing.ts`), which is the only place that can say it once
 * for every channel. Naming the channel here is what makes that checkable from the
 * outside — `packages/code/tests/the-channel-says-what-it-carries.test.ts` runs every
 * handler `hooks.json` declares and requires anything it puts in front of a model to
 * carry the declaration of a channel this file names. A handler added without one is
 * red, by its file name, which is the whole point: the next thing this plugin pushes
 * will be a rule matched to a prompt or to a path, and it must not arrive bare.
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
 * WHICH channel of the product's framing this handler carries — the name
 * `record-framing.ts` knows it by.
 *
 * It is a plain string and not an import because this file is what the host spawns:
 * it runs from the plugin's directory with no build and no package resolution, so it
 * cannot reach the surface's own module. It is EXPORTED so that it is a declaration
 * rather than a dead constant, and it is read from the SOURCE by the test rather than
 * imported — importing this module would run the handler, which spawns a subprocess.
 * The value is checked against `record-framing.ts`, so a name that drifts is red.
 */
export const MODEL_CHANNEL = 'brief-document';

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
