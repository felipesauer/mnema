#!/usr/bin/env node
/**
 * The gate, in a host whose hooks are processes: where a rule of the project's record asks for a
 * person at a path, the write waits for one, and where a rule refuses the write, it does not happen.
 *
 * WHICH HOST, AND WHY THIS FILE IS NOT THE PER-EDIT HOOK OF THE HOST THIS PLUGIN WAS WRITTEN
 * FOR. Claude Code runs the per-edit hook as a call into the MCP server (`type: "mcp_tool"` in
 * `hooks.json`), which costs a call on an open connection. VS Code's agent reads this same plugin
 * and runs only `type: "command"`, it drops an `mcp_tool` hook in silence, and it holds a write
 * for a person when a command answers `ask` (measured on VS Code 1.137 with Copilot Chat 0.65, on 30 Sep 2026). This handler is that command, and `hooks.json` runs it for VS
 * Code alone: it sits under a matcher of VS Code's own tool names, which Claude Code and Cursor
 * apply and never match (measured in both), and which VS Code does not read at all.
 *
 * THAT LAST FACT IS WHY THERE IS A FILTER IN FRONT OF IT. VS Code runs a plugin's command on every
 * tool call (a read, a search, a terminal) whatever its matcher says (measured: a matcher that
 * names no tool still ran). So `hooks.json`, generated from the host table, passes the payload here
 * only when it names one of the tools that write, in the shell and before any process starts;
 * everything else costs a shell. It also hands this handler its host and those tools (`--host
 * vscode --tools …`), and the handler checks them again before it runs `mnema`
 * (`hand-over.mjs`, `whatTheGateAnswers`): a second line, not the first.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to `mnema
 * before-a-write --host <host>` byte for byte and its answer comes back byte for byte; which rules
 * ask, what the reason says and which facts are recorded are the verb's, decided in the one place
 * the MCP tool decides them too. The rule for running a verb is `hand-over.mjs`'s.
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
 * WHICH channels of the product's framing this handler carries (the names `record-framing.ts`
 * knows them by, joined by `+`): the reason it hands back is the asking's or the refusal's,
 * whichever the write met. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'edit-asks-a-person+edit-refuses-a-write';

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
