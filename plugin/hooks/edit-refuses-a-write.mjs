#!/usr/bin/env node
/**
 * The refusal, in Cursor's agent and in Codex: where a rule of the project's record refuses a
 * write at a path, the write does not happen and the agent reads the rule that did it.
 *
 * CODEX RUNS IT TOO, from a hooks file of its own (`hooks/codex.json`, `--host codex`), on
 * `apply_patch`: Codex rejects an `ask` as unsupported and lets the patch through, so it is a
 * host that refuses alone, like Cursor, and needs no variable to say so — nobody else reads that
 * file.
 *
 * WHY THIS IS A FILE OF ITS OWN AND NOT `edit-asks-a-person.mjs`. Cursor's command-line agent
 * reads this same plugin, runs only `type: "command"` hooks, and answers a hook's `deny` by not
 * writing the file and handing the model the reason as the write's error — and it IGNORES `ask`
 * (measured on 2026.09.18). So the verb is asked for Cursor
 * (`--host cursor`), which answers a refusal and nothing else: a write that only asks goes through
 * and records no asking, because a person was not asked.
 *
 * `hooks.json` runs it for Cursor alone, and by the host's own environment rather than by a
 * matcher: Cursor and Claude Code both apply the matcher `Write|Edit|NotebookEdit` — Claude Code
 * runs the per-edit call into the server there — so the shell `hooks.json` generates from the
 * host table asks for `$CURSOR_VERSION`, which Cursor sets for every hook (measured) and Claude
 * Code does not, before any process starts. It also hands this handler its host and that variable
 * (`--host cursor --where CURSOR_VERSION`), and the handler checks it again before it runs `mnema`
 * (`hand-over.mjs`, `whatTheGateAnswers`): a second line, not the first.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to `mnema
 * before-a-write --host <host>` byte for byte and its answer comes back byte for byte; which
 * rules refuse, what the reason says and which facts are recorded are the verb's, decided in the
 * one place every door decides them (`what-a-write-meets.ts`). The rule for running a verb is
 * `hand-over.mjs`'s.
 *
 * IT NEVER BLOCKS BY FAILING. Every outcome that is not an answer is silence and exit 0 — no
 * `mnema` on the PATH, no project, a payload it could not read — and silence is `{}` to the host,
 * which lets the write through: a gate that cannot say why it stops somebody does not stop them.
 */

/**
 * WHICH channel of the product's framing this handler carries — the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'edit-refuses-a-write';

try {
  const { whatTheGateAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  const answer = await whatTheGateAnswers(
    process.argv.slice(2),
    process.env,
    whereTheSessionIs(),
    async () => {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf-8');
    },
  );
  if (answer !== null) process.stdout.write(answer);
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}
