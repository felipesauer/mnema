#!/usr/bin/env node
/**
 * The rules of the record addressed at a file the session just wrote, handed to the model beside the
 * write's result, in the hosts whose hook before a write cannot carry text: `mnema beside-a-write`,
 * run by Copilot CLI's `PostToolUse` after a `Write` or an `Edit`.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte
 * and its answer comes back byte for byte; which rules are handed and what the text says are the
 * verb's, composed by the one function the MCP tool and `mnema before-a-write` compose them with.
 * Its own arguments (`--host`, `--agent-key`, from the hooks file) are handed to the verb. The rule
 * for running a verb is `hand-over.mjs`'s, and so is the silence: the write has happened, so a
 * `mnema` that is missing, one too old to know the verb (it refuses it and exits non-zero), no
 * project, no rule at the path, the channel off or a payload with no session id all write no byte, and
 * where no rule of any tree has an address (`an-address-can-be-met.mjs`) no `mnema` is started at all.
 * Unlike the gate before a write there is nothing to close: this never refuses.
 */

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'edit-rules-push';

/**
 * How long `mnema` is given, in milliseconds: the write is done and the rules are a courtesy beside
 * its result, so a `mnema` that does not answer stalls the session for this and no longer, where the
 * host's own kill would stall it for 15 seconds (measured on Copilot CLI 1.0.104: the write goes
 * through either way, and no fact is left).
 */
const WAIT = 6000;

try {
  const { whatTheVerbAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  const { anAddressCanBeMet } = await import('./an-address-can-be-met.mjs');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const where = whereTheSessionIs();
  // NO RULE HAS AN ADDRESS, SO NO `mnema` STARTS, as in the gate before a write: the verb would answer
  // `{}`, and loading it is most of what a write costs here (about 250 ms, measured). Read from the
  // stored lines of every tree, and any doubt starts it.
  const answer = anAddressCanBeMet(where, process.env)
    ? whatTheVerbAnswers(
        ['beside-a-write', ...process.argv.slice(2)],
        where,
        Buffer.concat(chunks).toString('utf-8'),
        WAIT,
      )
    : null;
  if (answer !== null) process.stdout.write(answer);
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}
