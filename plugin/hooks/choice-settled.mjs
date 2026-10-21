#!/usr/bin/env node
/**
 * After a question the agent asked the person was answered: `mnema settled` hands the agent one
 * sentence of fact beside the answer, that a choice may have been settled there and which tool
 * records it. Nothing is recorded.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte
 * and its answer comes back byte for byte; which tools are questions and what the sentence says are
 * the verb's. Its own arguments (`--reply flat`, from the hooks file of a host that reads the flat
 * reply) are handed to the verb. The rule for running a verb is `hand-over.mjs`'s, and so is the
 * silence: no `mnema` on the PATH, no project, a tool that is not a question, the channel off.
 */

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'choice-settled';

try {
  const { whatTheVerbAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const answer = whatTheVerbAnswers(
    ['settled', ...process.argv.slice(2)],
    whereTheSessionIs(),
    Buffer.concat(chunks).toString('utf-8'),
  );
  if (answer !== null) process.stdout.write(answer);
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}
