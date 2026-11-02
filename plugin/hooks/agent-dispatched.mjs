#!/usr/bin/env node
/**
 * What a session hands to other agents, kept in the record: after the host's `Agent` tool, and when a
 * session ends, `mnema dispatched` records one private task for the session and a private handoff
 * for each dispatch, and closes the task at the end (unless somebody switched `agent-mirror` off).
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte;
 * which event it is, what is recorded and what is never recorded (the prompt) are the verb's. The
 * rule for running a verb is `hand-over.mjs`'s, and so is the silence: no `mnema` on the PATH, no
 * project, the channel off.
 *
 * IT WRITES NOTHING TO THE HOST, and carries no channel of the product's framing: what the verb
 * prints is `{}`, and the second stream, where it says what it could not do, is not handed on, so
 * nothing is put in front of the model.
 *
 * THE HOOKS FILE HANDS IT `--tools Agent,Task` on the hook after the host's agent tool, and no shell
 * in front: a hook command is one program and its arguments. VS Code runs a plugin's command on every
 * tool call whatever its matcher says, so the handler ends before it starts `mnema` for any tool that
 * is not named. The hook at the end of a session is given no tools and runs for what it is handed.
 *
 * IT NEVER FAILS A DISPATCH. Every outcome is exit 0.
 */

/** The verb and nothing else: the event, the tool and the session are in the payload. */
const VERB = ['dispatched'];

try {
  const { theToolIsNotNamed, whatTheVerbAnswers, whereTheSessionIs } = await import(
    './hand-over.mjs'
  );
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const payload = Buffer.concat(chunks).toString('utf-8');
  // `--tools Agent,Task` is the hooks file's, on the hook after the host's agent tool; the hook at
  // the end of a session is given none and always runs.
  if (!theToolIsNotNamed(process.argv.slice(2), payload)) {
    whatTheVerbAnswers(VERB, whereTheSessionIs(), payload);
  }
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}
