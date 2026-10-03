#!/usr/bin/env node
/**
 * What the session did, said as a fact: at the end of a response that wrote a file, and before a
 * conversation is compacted, a line saying how many files the session's own tool calls wrote and
 * how many decisions were recorded since it opened.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload the host hands a `Stop` or a
 * `PreCompact` hook goes to `mnema tally` byte for byte and its answer comes back byte for
 * byte; which event it is, what was counted and what the line says are the verb's, which reads the
 * transcript the payload names and the record. The rule for running a verb is `hand-over.mjs`'s.
 *
 * NO MODEL IS CALLED, and nothing is written to the record: the line is a count, in the words the
 * other handlers use for a fact — what was counted, and from where — and not an instruction.
 *
 * IT NEVER BLOCKS BY FAILING. Every outcome that is not an answer is silence and exit 0 — no
 * `mnema` on the PATH, no project, a transcript it could not read, the channel switched off
 * (`mnema switch off session-tally`) — and silence is no output at all, which a host reads as
 * nothing to say.
 */

/**
 * WHICH channel of the product's framing this handler carries — the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'session-tally';

/** The verb and nothing else: the event is in the payload, never guessed from a flag. */
const VERB = ['tally'];

try {
  const { whatTheVerbAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const answer = whatTheVerbAnswers(
    VERB,
    whereTheSessionIs(),
    Buffer.concat(chunks).toString('utf-8'),
  );
  if (answer !== null) process.stdout.write(answer);
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}
