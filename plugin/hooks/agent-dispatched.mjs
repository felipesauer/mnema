#!/usr/bin/env node
/**
 * What a session hands to other agents, kept in the record: after the host's `Agent` tool, and when a
 * session ends, `mnema dispatched` records one private task for the session and a private handoff
 * for each dispatch, and closes the task at the end (unless somebody switched `agent-mirror` off).
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte;
 * which event it is, what is recorded and what is never recorded (the prompt) are the verb's. The
 * rule for running a verb is `hand-over.mjs`'s, and so is the silence: no `mnema` on the PATH, no
 * project, the channel off. What the verb prints is `{}`, and nothing is put in front of the model.
 *
 * IT NEVER FAILS A DISPATCH. Every outcome is exit 0.
 */

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'agent-mirror';

/** The verb and nothing else: the event, the tool and the session are in the payload. */
const VERB = ['dispatched'];

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
