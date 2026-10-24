#!/usr/bin/env node
/**
 * What a session had recorded before its conversation was compacted, said to the conversation that
 * continues: one sentence, read from the journal `mnema tally` keeps for the session.
 *
 * WHY IT EXISTS. A compaction replaces the conversation with a summary, and the decisions a session
 * settled and recorded are among the first things a summary drops. The two handlers that run at
 * every `SessionStart` (the brief, the notes) fire again after a compaction and hand back what the
 * PROJECT holds; what the SESSION had done with the record is what is lost, and the journal holds it.
 *
 * IT RUNS ONLY AFTER A COMPACTION: the hooks file gives it the `compact` matcher of `SessionStart`,
 * which the host applies to the source of the start. It reads its stdin for one thing, the id of the
 * session the payload names, and hands it to the verb as `mnema recall --after-a-compaction
 * --session <id>`. The rule for running a verb is `hand-over.mjs`'s; this handler asks it with no
 * fallback, so a `mnema` older than the flag, which refuses it, is silence here and not the whole
 * notes document a second time.
 *
 * IT DECIDES NOTHING AND CARRIES NO TEXT OF ITS OWN. What reaches the session is exactly what the
 * verb printed, a count in the words of the other hooks (what was counted, and from where) with the
 * labels of the decisions the record numbered, and nothing of anybody's words.
 *
 * IT NEVER BLOCKS BY FAILING. Every outcome that is not a sentence is silence and exit 0: no
 * `mnema` on the PATH, no project, no session id on the payload, no journal, nothing recorded, the
 * channel switched off (`mnema switch off after-a-compaction`).
 */

/** The event this handler answers, echoed back so the host can route the reply. */
const HOOK_EVENT = 'SessionStart';

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts` knows it
 * by. Read from this SOURCE by the channel guard, never imported: importing this module would run it.
 */
export const MODEL_CHANNEL = 'after-a-compaction';

/**
 * The session id a hook payload names, or undefined where it names none or is not JSON.
 *
 * @param {string} payload
 * @returns {string | undefined}
 */
function sessionOf(payload) {
  try {
    const id = JSON.parse(payload).session_id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

try {
  const { reply, whatTheVerbAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  const chunks = [];
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) chunks.push(chunk);
  const session = sessionOf(Buffer.concat(chunks).toString('utf-8'));
  if (session !== undefined) {
    const sentence = whatTheVerbAnswers(
      ['recall', '--after-a-compaction', '--session', session],
      whereTheSessionIs(),
      '',
    );
    if (sentence !== null) {
      process.stdout.write(reply(HOOK_EVENT, sentence.trim(), process.argv.slice(2)));
    }
  }
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse than it
  // would have been without the plugin installed.
}
