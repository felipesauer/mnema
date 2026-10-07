#!/usr/bin/env node
/**
 * The gate, in a host whose hooks are processes: where a rule of the project's record asks for a
 * person at a path, the write waits for one, and where a rule refuses the write, it does not happen.
 *
 * WHICH HOST, AND WHY THIS FILE IS NOT THE PER-EDIT HOOK OF THE HOST THIS PLUGIN WAS WRITTEN
 * FOR. Claude Code runs the per-edit hook as a call into the MCP server (`type: "mcp_tool"` in
 * `hooks.json`), which costs a call on an open connection. VS Code's agent reads this same plugin
 * and runs only `type: "command"` — it drops an `mcp_tool` hook in silence — and it holds a write
 * for a person when a command answers `ask` (measured on VS Code 1.137 with Copilot Chat 0.65, on 30 Sep 2026). This handler is that command, and `hooks.json` runs it for VS
 * Code alone: it sits under a matcher of VS Code's own tool names, which Claude Code and Cursor
 * apply and never match (measured in both), and which VS Code does not read at all.
 *
 * THAT LAST FACT IS WHY THERE IS A FILTER IN FRONT OF IT. VS Code runs a plugin's command on every
 * tool call — a read, a search, a terminal — whatever its matcher says (measured: a matcher that
 * names no tool still ran). So `hooks.json` passes the payload here only when it names one of the
 * tools that write, in the shell and before any process starts; everything else costs a shell.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to `mnema
 * before-a-write --host vscode` byte for byte and its answer comes back byte for byte; which rules
 * ask, what the reason says and which facts are recorded are the verb's, decided in the one place
 * the MCP tool decides them too. The rule for running a verb is `hand-over.mjs`'s.
 *
 * IT NEVER BLOCKS BY FAILING. Every outcome that is not an answer is silence and exit 0 — no
 * `mnema` on the PATH, no project, a payload it could not read — and silence is `{}` to the host,
 * which lets the write through: a gate that cannot say why it stops somebody does not stop them.
 */

/**
 * WHICH channels of the product's framing this handler carries — the names `record-framing.ts`
 * knows them by, joined by `+`: the reason it hands back is the asking's or the refusal's,
 * whichever the write met. Read from this SOURCE by the channel guard, never imported: importing this module
 * would run it.
 */
export const MODEL_CHANNEL = 'edit-asks-a-person+edit-refuses-a-write';

/** The verb and its flags: the host is declared, never guessed from the payload. */
const VERB = ['before-a-write', '--host', 'vscode'];

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
