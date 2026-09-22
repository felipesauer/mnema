/**
 * How a handler of this plugin hands a session what a verb prints — written once, for every
 * handler that does it.
 *
 * THERE ARE TWO OF THEM NOW, AND THAT IS WHY THIS FILE EXISTS. `session-start.mjs` hands over
 * the document `mnema brief` prints and `session-recall.mjs` hands over the notes `mnema
 * recall` prints, at the same moment and by the same rule. The rule used to live inside the
 * first handler; a second handler written as a copy of it would be two readings of one rule,
 * which is the shape that comes to disagree in silence — one of them learning to keep the
 * second stream, say, while the other went on dropping it. So the rule is here, and each
 * handler is its channel's declaration and one call.
 *
 * IT WRITES NOTHING TO A MODEL ITSELF, and it is built that way on purpose. What reaches a
 * session is what a handler writes out, and the channel guard requires every handler that
 * writes out to name the channel it carries; this module only answers with the text, so it
 * carries no channel and has none to name. The handlers do the writing.
 *
 * A HANDLER NEVER BLOCKS AND NEVER FAILS LOUD, AND THAT IS STILL TRUE. Every outcome that is
 * not a text is silence — no project here, no `mnema` on the PATH, a record that will not
 * read, a channel switched off — collapsed into one `null` ({@link whatTheVerbSays}), so there
 * is ONE gate and a single place to remove if this plugin ever stopped being quiet. Asserted
 * in `packages/code/tests/the-record-arrives-unasked.test.ts` for every command `hooks.json`
 * declares ("says nothing at all where there is no project").
 *
 * WHAT IT NEVER COVERED IS A RECORD THAT DOES NOT CHAIN, and the three outcomes measured on
 * the built binary are what separate the two: outside a project a verb exits 1 with its
 * refusal on stderr; over a SOUND record it exits 0 with an empty stderr; over a record whose
 * tails stop chaining it exits 0 and the notice is on stderr. So with exit 0 the second
 * stream holds bytes only when there is something to say about the RECORD — the product's
 * own words, from `packages/code/src/record-integrity.ts` — and they go over under the text,
 * byte for byte, with a blank line between. The ORDER is the product's rule: the MCP puts the
 * answer first and the record's own state under it (`packages/code/src/mcp/server.ts`).
 *
 * IT DECIDES NOTHING ABOUT WHAT THE AGENT READS. The text goes over BYTE FOR BYTE — no
 * preamble of a handler's, no cut. A second place deciding what a session is told about the
 * record is a second place that can come to disagree with it. Asserted in the same test
 * ("hands over exactly what the verb prints").
 */

import { spawnSync } from 'node:child_process';

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
 * Nothing is read from stdin: a handler needs no input, and a reader waiting on a pipe the
 * host may not close is a session that opens late for no gain.
 *
 * @returns {string}
 */
export function whereTheSessionIs() {
  const named = process.env.CLAUDE_PROJECT_DIR;
  return named !== undefined && named !== '' ? named : process.cwd();
}

/** What separates a verb's text from what the same run said about the record under it. */
const BETWEEN_THE_STREAMS = '\n\n';

/**
 * What a verb has to say here, or `null` when it has nothing.
 *
 * BOTH STREAMS ARE KEPT AND THE EXIT CODE IS WHAT PICKS. A refusal arrives with a non-zero
 * status, which is this function's `null`, so stderr is only ever read on the path where the
 * verb succeeded — and on that path it is empty unless the record itself has something to
 * say. A text that is empty is silence too: `mnema recall` over a project with no notes
 * prints nothing and exits 0, and a session there is handed nothing.
 *
 * @param {string} verb The verb to run — each handler names its own.
 * @param {string} cwd Where to run it — the host's project directory, or this process's own
 *   when the host announced none.
 * @returns {string | null}
 */
export function whatTheVerbSays(verb, cwd) {
  const ran = spawnSync(BINARY, [verb], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // EVERY NON-ZERO OUTCOME IS STILL SILENCE, and the refusal on stderr goes with it: it
  // is addressed to a person who typed a verb, and nobody typed this one.
  if (ran.error !== undefined || ran.status !== 0) return null;
  const text = ran.stdout ?? '';
  if (text.trim() === '') return null;
  const alsoSaid = (ran.stderr ?? '').trim();
  return alsoSaid === '' ? text : `${text}${BETWEEN_THE_STREAMS}${alsoSaid}`;
}

/**
 * The reply the host reads: the text as context for the session, under the event it answers.
 *
 * The event name is echoed back because the host routes the reply by it, and a reply naming
 * the wrong one is dropped in silence.
 *
 * @param {string} event
 * @param {string} text
 * @returns {string}
 */
export function reply(event, text) {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`;
}
