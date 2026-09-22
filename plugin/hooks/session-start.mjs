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
 * on the PATH, a record that will not read. Asserted in
 * `packages/code/tests/the-record-arrives-unasked.test.ts` ("says nothing at all where
 * there is no project").
 *
 * THE REASON UNDER THAT USED TO BE WIDER THAN THE MEASUREMENT IT CAME FROM, and it is
 * narrowed rather than dropped. It read: *"A hook is not a place to diagnose: the
 * session belongs to the person who opened it, and a diagnosis nobody asked for buys
 * nothing."* What it was measured against is the case above — a directory with no
 * record in it, where the verb has nothing to say and says it on stderr with exit 1, so
 * a handler wired straight to the verb would put a refusal into every session of every
 * project on the machine of whoever installs this. That case is untouched and the
 * silence is still exit-code-gated.
 *
 * WHAT IT NEVER COVERED IS A RECORD THAT DOES NOT CHAIN, and the three outcomes measured
 * on the built binary are what separate the two: outside a project the verb exits 1 with
 * 47 bytes of refusal on stderr; over a SOUND
 * record it exits 0 with an empty stderr; over a record whose tails stop chaining it
 * exits 0 and the notice is on stderr. So with exit 0 the second stream holds bytes only
 * when there is something to say about the RECORD — and those bytes are not a diagnosis
 * this file made up, they are the product's own, written by the same invocation, in the
 * one place that words them (`packages/code/src/record-integrity.ts`). Dropping them was
 * the document telling an agent what governs the work while the proof behind it had
 * failed. Asserted in the same file ("says that the record does not chain, when it does
 * not").
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
 * AND THAT IS NOW TRUE OF BOTH STREAMS THE VERB WROTE, which is the one thing about this
 * sentence that changed. What goes over is stdout, and under it whatever the same run put
 * on stderr — byte for byte again, with a blank line between them and not a word of this
 * file's. The ORDER is the product's own rule and not a choice made here: the MCP puts the
 * answer first and the record's own state under it, because the state qualifies the whole
 * reply (`packages/code/src/mcp/server.ts`, `replied`). A document with no second stream
 * behind it is unchanged, byte for byte, which is every document over a sound record.
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
 * IT IS SWITCHABLE, AND THAT COST THIS FILE NOTHING — which is the whole reason the note is
 * here rather than in a branch. The document is one of the two places this product puts the
 * record in front of a model unasked, and both can be switched off with the switching
 * recorded (`mnema switch`). Off, the verb refuses on stderr and exits non-zero — and every
 * non-zero outcome here was already silence, by the rule above. So a session whose document
 * was switched off opens with nothing added, and not one byte of this handler decides that.
 * Asserted in `packages/code/tests/the-record-arrives-unasked.test.ts` ("says nothing at all
 * when the document channel is switched OFF").
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

/** What separates the document from what the same run said about the record under it. */
const BETWEEN_THE_STREAMS = '\n\n';

/**
 * What the record has to say here, or `null` when it has nothing.
 *
 * `null` is every silent outcome collapsed into one value, so there is ONE gate above
 * and a single place to remove if this plugin ever stopped being quiet.
 *
 * BOTH STREAMS ARE KEPT AND THE EXIT CODE IS WHAT PICKS, which is the whole of the
 * change and the reason it costs nothing. `stderr` used to be dropped at the spawn, on
 * a reason addressed to the case where the verb REFUSES — and a refusal arrives with a
 * non-zero status, which is already this function's `null`. So the stream is only ever
 * read on the path where the verb succeeded, and on that path it is empty unless the
 * record itself has something to say (see the note at the top of this file).
 *
 * @param {string} cwd Where to run the verb — the host's project directory, or this
 *   process's own when the host announced none.
 * @returns {string | null}
 */
function theDocument(cwd) {
  const ran = spawnSync(BINARY, ['brief'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // EVERY NON-ZERO OUTCOME IS STILL SILENCE, and the refusal on stderr goes with it: it
  // is addressed to a person who typed a verb, and nobody typed this one.
  if (ran.error !== undefined || ran.status !== 0) return null;
  const document = ran.stdout ?? '';
  if (document.trim() === '') return null;
  const alsoSaid = (ran.stderr ?? '').trim();
  return alsoSaid === '' ? document : `${document}${BETWEEN_THE_STREAMS}${alsoSaid}`;
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
