#!/usr/bin/env node
/**
 * The refusal, in Cursor's agent and in Codex: where a rule of the project's record refuses a
 * write at a path, the write does not happen and the agent reads the rule that did it.
 *
 * CODEX RUNS IT TOO, from a hooks file of its own (`hooks/codex.json`, `--host codex`), on
 * `apply_patch`: Codex rejects an `ask` as unsupported and lets the patch through, so it is a
 * host that refuses alone, like Cursor, and needs no variable to say so. Nobody else reads that
 * file.
 *
 * WHY THIS IS A FILE OF ITS OWN AND NOT `edit-asks-a-person.mjs`. Cursor's command-line agent
 * reads this same plugin, runs only `type: "command"` hooks, and answers a hook's `deny` by not
 * writing the file and handing the model the reason as the write's error, and it IGNORES `ask`
 * (measured on 2026.09.18). So the verb is asked for Cursor
 * (`--host cursor`), which answers a refusal and nothing else: a write that only asks goes through
 * and records no asking, because a person was not asked.
 *
 * `hooks.json` runs it for Cursor alone, and by the host's own environment rather than by a
 * matcher: Cursor and Claude Code both apply the matcher `Write|Edit|NotebookEdit`, Claude Code
 * runs the per-edit call into the server there, so the shell `hooks.json` generates from the
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
 * A GATE THAT CANNOT SAY WHY IT STOPS NOBODY IS NO GATE, SO WHERE IT CANNOT RUN IT REFUSES. A `mnema` that is
 * there and does not answer (it exits non-zero, it does not finish in time, what it prints is not a
 * JSON reply, no `node` on the PATH takes it) answers `deny`, with the reason in words and the way
 * out (`hand-over.mjs`, `whatTheGateAnswers`), and so does a fault of this handler itself: a host
 * reads silence as a write that may go on, and a record with a rule at an address is what brought
 * this process to life. Where there is no `mnema` at all, no project or no rule that could be met,
 * nothing refuses: silence and exit 0, as before (`without-mnema-the-hooks-fail-open.test.ts`).
 * The same checks the hooks file's shell made hold in the refusal: where the host's variable is
 * unset, or the tool is not one that writes, nothing is refused.
 */

/**
 * WHICH channel of the product's framing this handler carries: the name `record-framing.ts`
 * knows it by. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'edit-refuses-a-write';

let handed = '';
try {
  const { whatTheGateAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  const answer = await whatTheGateAnswers(
    process.argv.slice(2),
    process.env,
    whereTheSessionIs(),
    async () => {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      handed = Buffer.concat(chunks).toString('utf-8');
      return handed;
    },
  );
  if (answer !== null) process.stdout.write(answer);
} catch (fault) {
  // A fault of this handler itself, not of `mnema`: the write is refused, unless this call is one the
  // hooks file's own arguments say starts nothing (the host's variable unset, a tool that does not
  // write), which was never the gate's to answer. Self-contained on purpose: the module that failed
  // may be the one that would have said it.
  const argv = process.argv.slice(2);
  const flagValue = (/** @type {string} */ flag) =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
  const where = flagValue('--where');
  const tools = flagValue('--tools');
  let tool = '';
  try {
    // Where the fault came before the payload was read, and the call is only this handler's if the
    // tool is one that writes, the payload is read now.
    if (tools !== undefined && handed === '') {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      handed = Buffer.concat(chunks).toString('utf-8');
    }
    tool = JSON.parse(handed).tool_name ?? '';
  } catch {
    // No payload that names a tool: the filter below then has nothing to turn the call away by.
  }
  const startsNothing =
    (where !== undefined && (process.env[where] ?? '') === '') ||
    (tools !== undefined && !tools.split(',').includes(tool));
  if (!startsNothing) {
    const said = String(fault instanceof Error ? fault.message : fault)
      .split('\n')[0]
      ?.slice(0, 120);
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `The mnema gate could not run (${said}). A gate that cannot read the record does not let a write through, since the record may hold a rule that refuses it. Reinstall the mnema plugin, and run \`mnema doctor\` in a terminal to see what is wrong.`,
        },
      })}\n`,
    );
  }
}
