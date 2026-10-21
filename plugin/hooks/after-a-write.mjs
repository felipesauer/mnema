#!/usr/bin/env node
/**
 * What a file the session just wrote means to the record: after a `Write` or an `Edit`, `mnema
 * after-a-write` copies a note of the host's own memory into this machine's private tree (only where
 * somebody switched `host-memory-mirror` on), or names, once per session and file, the command that
 * reads a file of decisions the record cites nowhere.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte
 * and its answer comes back byte for byte; which file is which, what is copied and what the line says
 * are the verb's. The rule for running a verb is `hand-over.mjs`'s, and so is the silence: no `mnema`
 * on the PATH, no project, a file it could not read, the channel off.
 *
 * MOST WRITES NEVER START IT. The hooks file puts a shell in front that reads the path out of the
 * payload and passes on only a path that can be one of the two kinds; every other write costs a shell
 * and nothing else.
 */

/**
 * WHICH channels of the product's framing this handler carries: the names `record-framing.ts` knows
 * them by. Read from this SOURCE by the channel guard, never imported: importing this module would
 * run it.
 */
export const MODEL_CHANNEL = 'host-memory-mirror+decision-file-written';

/** The verb and nothing else: the event, the tool and the path are in the payload. */
const VERB = ['after-a-write'];

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
