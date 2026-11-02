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
 *
 * THE HOOKS FILE HANDS IT `--tools AskUserQuestion` and no shell in front: a hook command is one
 * program and its arguments. VS Code runs a plugin's command on every tool call whatever its matcher
 * says, so the handler starts for a read too, and ends before it starts `mnema` for any tool that is
 * not named (`the-hooks-file-runs-no-shell.test.ts`).
 */

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'choice-settled';

try {
  const {
    theToolIsNotNamed,
    whatTheVerbAnswers,
    whereTheSessionIs,
    withoutTheFiltersOfTheHooksFile,
  } = await import('./hand-over.mjs');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const payload = Buffer.concat(chunks).toString('utf-8');
  const argv = process.argv.slice(2);
  // `--tools AskUserQuestion` is the hooks file's: a host that runs this command on every tool call
  // starts it, and it ends here for any tool but the question.
  const answer = theToolIsNotNamed(argv, payload)
    ? null
    : whatTheVerbAnswers(
        ['settled', ...withoutTheFiltersOfTheHooksFile(argv)],
        whereTheSessionIs(),
        payload,
      );
  if (answer !== null) process.stdout.write(answer);
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}
