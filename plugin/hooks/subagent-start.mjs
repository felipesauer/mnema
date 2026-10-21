#!/usr/bin/env node
/**
 * The record reaches a subagent as it starts: whatever `mnema brief` prints, handed to the
 * subagent that begins, the way `session-start.mjs` hands it to the session that opens.
 *
 * A SUBAGENT STARTS WITH A CONTEXT OF ITS OWN and does not see what the session was handed when it
 * opened, so what governs the work reaches it only if something hands it over. This is the same
 * verb, the same channel and the same switch as the opening's (`mnema switch off brief-document`
 * silences both), and the rule for running a verb and for staying silent is `hand-over.mjs`'s:
 * every outcome that is not a document is silence and exit 0.
 *
 * IT DECIDES NOTHING ABOUT WHAT THE SUBAGENT READS. The document goes over byte for byte, under the
 * event the host routes the reply by.
 */

/** The event this handler answers, echoed back so the host can route the reply. */
const HOOK_EVENT = 'SubagentStart';

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'brief-document';

try {
  const { reply, whatTheVerbSays, whereTheSessionIs } = await import('./hand-over.mjs');
  const document = whatTheVerbSays(
    'brief',
    whereTheSessionIs(),
    { namesAStranger: true },
    process.argv.slice(2),
  );
  if (document !== null) process.stdout.write(reply(HOOK_EVENT, document, process.argv.slice(2)));
} catch {
  // Silence, deliberately: a hook that could not do its work must not make a subagent worse.
}
