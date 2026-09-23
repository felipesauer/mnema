#!/usr/bin/env node
/**
 * What was noted here comes back: whatever `mnema recall` prints, handed to the session as
 * it opens, beside the document the other `SessionStart` handler hands over.
 *
 * WHY IT EXISTS. A memory or an observation an agent records here reached no later session
 * unless that session went looking. The document a session opens with carries what
 * GOVERNS, and a note governs nothing; and an agent's note lands in the tree that does not
 * travel, which the document may not carry because it is written to be committed. This
 * handler is the other half: the notes this machine holds for the project, handed to this
 * machine's session, in a text that is never a file.
 *
 * WHY IT IS A SECOND HANDLER AND NOT A SECOND HALF OF THE FIRST, and the reason is the
 * host's. What a hook adds to a session is capped at 10,000 characters per hook, and over
 * the cap the host swaps the whole text for a file path and a 2,000-character preview it
 * never asks the model to open (code.claude.com/docs/en/hooks, *JSON output*). Two texts in
 * one reply would share one cap, and a long document would take the notes down with it, or
 * the notes the document. Two handlers are two replies, each measured on its own — and the
 * host runs every matching hook in parallel, so the second one costs no wait.
 *
 * IT IS SILENT IN EVERY CASE THE FIRST ONE IS, AND IN ONE MORE. The rule is the shared one
 * (`hand-over.mjs`): outside a project, with no `mnema` on the PATH, over a record that will
 * not read, or with this channel switched off, nothing is added. And where nothing is noted
 * the verb prints nothing, so a session in a project with no notes is handed no text at all
 * — the rule the per-edit push keeps: nothing arrives where there is nothing to say.
 *
 * IT IS A CHANNEL, AND THE CHANNEL IS DECLARED — {@link MODEL_CHANNEL}, framed in the words
 * `packages/code/src/record-framing.ts` gives every channel that puts record text in front
 * of a model, and switchable on its own (`mnema switch off recall-document`), because
 * somebody who wants the rules and not the notes must be able to keep the half they want.
 */

/** The event this handler answers, echoed back so the host can route the reply. */
const HOOK_EVENT = 'SessionStart';

/**
 * WHICH channel of the product's framing this handler carries — the name
 * `record-framing.ts` knows it by.
 *
 * A plain string, exported and read from the source by the guard, for the reasons the
 * other handler's is: this file runs from the plugin's directory with no build, and
 * importing it would run it.
 */
export const MODEL_CHANNEL = 'recall-document';

try {
  // Imported INSIDE the guard, for the other handler's reason: a plugin directory missing
  // its sibling module is a session opened with nothing added, not a hook error.
  const { reply, whatTheVerbSays, whereTheSessionIs } = await import('./hand-over.mjs');
  const notes = whatTheVerbSays('recall', whereTheSessionIs());
  if (notes !== null) process.stdout.write(reply(HOOK_EVENT, notes));
} catch {
  // Silence, with nothing to add: the one thing a handler of this plugin must never do is
  // make somebody else's session worse than it would have been without it.
}
