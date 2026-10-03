#!/usr/bin/env node
/**
 * What a person corrected, recorded as a proposal: at `Stop`, `mnema corrections` reads the
 * transcript the host names and records each place where the person corrected the agent as a
 * `proposed` decision in this machine's private tree.
 *
 * OFF UNTIL SOMEBODY SWITCHES IT ON (`mnema switch on user-corrections`). It is the one handler of
 * this plugin that reads what a person typed, and the one that writes without anybody typing a
 * verb, so it does nothing in a project that never asked for it: the verb answers `{}`, and a handler
 * that has nothing to say writes no byte.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte
 * and its answer comes back byte for byte; which prompts are corrections, what is recorded and what
 * the line says are the verb's. The rule for running a verb is `hand-over.mjs`'s, and so is the
 * silence: no `mnema` on the PATH, no project, a transcript it could not read, the channel off.
 */

/**
 * WHICH channel of the product's framing this handler carries — the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'user-corrections';

/** The verb and nothing else: the event is in the payload. */
const VERB = ['corrections'];

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
