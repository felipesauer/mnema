/**
 * What a host whose hooks are PROCESSES hands a hook before a file is written, and how such a
 * host is answered — for the hosts where the record can ask for a person that way.
 *
 * Claude Code runs this product's per-edit hook as a call into the connected MCP server
 * (`type: "mcp_tool"`), and its reply is shaped in `mcp/hook-reply.ts`. The other hosts that read
 * the plugin run only `type: "command"`: a process, handed a JSON payload on stdin, answering on
 * stdout. This module is what the command half knows about each of them, measured against the
 * host installed on the day (`measurements/hooks-by-host/`), and nothing here decides whether a
 * write asks — that is `whatAWriteAsks`, the one site both doors pass through.
 *
 * ## Which hosts, and why only one
 *
 * {@link HookHost} is a union of ONE, `vscode`, and the reason is a measurement rather than a
 * backlog. VS Code 1.137 with Copilot Chat 0.65 runs a plugin's `PreToolUse` command before the
 * tool, and a reply carrying `permissionDecision: "ask"` holds the write for a person (the host's
 * own log: *"requires confirmation (preToolUse hook returned 'ask')"*; the file stayed unwritten).
 * Cursor's command-line agent 2026.09.18 runs the same hook before its write — and IGNORES `ask`:
 * the file was written, from its own hook file and from the plugin alike, while `deny` was
 * honored. A host that does not ask cannot be told to, and recording that it asked would be the
 * fact reading backwards; so Cursor has no member here, and the page says so with the number.
 *
 * ## What the host hands over, and the two shapes that differ from Claude Code's
 *
 *   - THE TOOL NAMES ARE THE HOST'S OWN. VS Code's agent writes through `create_file`,
 *     `replace_string_in_file`, `multi_replace_string_in_file`, `insert_edit_into_file`,
 *     `edit_notebook_file` and `apply_patch` — which of them a session is offered depends on the
 *     model family (measured: `apply_patch` for the GPT families, `multi_replace_string_in_file`
 *     for the Claude ones). {@link WRITES} names every one.
 *   - THE PATH IS `filePath`, camelCase, and for two tools it is not one field. A multi-replace
 *     carries a list of replacements, each with its own `filePath`; a patch carries its paths
 *     inside its text, on the lines that open each file. A write whose input names no path this
 *     module can read answers with an empty list, and the caller says so on its second stream
 *     rather than guessing a path.
 *
 * ## VS Code does not read the matcher — which is what makes the plugin entry safe elsewhere
 *
 * The plugin declares this hook under a matcher of VS Code's tool names. Claude Code and Cursor
 * apply a matcher, and neither has a tool by those names, so neither runs it (measured, both).
 * VS Code runs a plugin's command on EVERY tool call whatever the matcher says (measured: a
 * matcher naming no tool at all still ran), which is why this module answers "not a write" for
 * every other tool, and why the plugin puts a filter in front of the process.
 */

import type { HookHost } from './host-names.js';
import { type HookSaid, hookReply } from './mcp/hook-reply.js';

/** How to read the paths out of one write tool's input. */
type PathsOf = (input: Readonly<Record<string, unknown>>) => readonly string[];

/** The one path of a tool that writes one file, under the field the host names it. */
const filePath: PathsOf = (input) =>
  typeof input['filePath'] === 'string' && input['filePath'] !== '' ? [input['filePath']] : [];

/** The files a multi-replace touches: one `filePath` per replacement, each once. */
const replacements: PathsOf = (input) => {
  const list = Array.isArray(input['replacements']) ? input['replacements'] : [];
  const paths = list.flatMap((one) =>
    typeof one === 'object' &&
    one !== null &&
    typeof (one as Record<string, unknown>)['filePath'] === 'string'
      ? [(one as Record<string, string>)['filePath'] as string]
      : [],
  );
  return [...new Set(paths.filter((path) => path !== ''))];
};

/**
 * The lines of a patch that name a file it writes, and the path each one names.
 *
 * The patch format the host's `apply_patch` takes opens each file with one of three headers and
 * may rename one with a fourth; every path a patch writes, deletes or moves to is on one of them.
 * A deleted file is a write for this purpose — a rule that asks for a person before a file under
 * it changes is asked before it disappears.
 */
const PATCH_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/;

/** The files a patch touches, read off its headers, each once. */
const patch: PathsOf = (input) => {
  const text = typeof input['input'] === 'string' ? input['input'] : '';
  const paths = text.split(/\r?\n/).flatMap((line) => {
    const named = PATCH_HEADER.exec(line)?.[1]?.trim();
    return named === undefined || named === '' ? [] : [named];
  });
  return [...new Set(paths)];
};

/**
 * The tools each host writes a file through, and where each one's path is.
 *
 * A table per host, total over {@link HookHost}, so a host added to the union does not compile
 * until somebody has said which of its tools write.
 */
const WRITES: { readonly [H in HookHost]: { readonly [tool: string]: PathsOf } } = {
  vscode: {
    create_file: filePath,
    replace_string_in_file: filePath,
    insert_edit_into_file: filePath,
    edit_notebook_file: filePath,
    multi_replace_string_in_file: replacements,
    apply_patch: patch,
  },
};

/** The tool names a host writes through — what the plugin's filter and matcher name. */
export function writeToolsOf(host: HookHost): readonly string[] {
  return Object.keys(WRITES[host]);
}

/**
 * The paths a host's hook payload is about to write, or `undefined` when the tool is not one
 * that writes a file.
 *
 * `undefined` and `[]` are different answers on purpose: the first is the ordinary case on a
 * host that runs this hook for every tool, and the caller answers it with silence; the second is
 * a write whose input did not say where, which the caller answers with silence AND a line on its
 * second stream, because a gate that stopped firing because a host renamed a field must not
 * stop in silence.
 */
export function pathsOfAWrite(host: HookHost, payload: unknown): readonly string[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { tool_name: tool, tool_input: input } = payload as Record<string, unknown>;
  if (typeof tool !== 'string') return undefined;
  const read = WRITES[host][tool];
  if (read === undefined) return undefined;
  return typeof input === 'object' && input !== null ? read(input as Record<string, unknown>) : [];
}

/**
 * The reply a host reads, for what the record has to say.
 *
 * VS Code reads the same reply Claude Code does — `hookSpecificOutput`, `permissionDecision`,
 * `permissionDecisionReason` — measured, so the shape is written once, in `mcp/hook-reply.ts`,
 * and this is the table that says so per host rather than a second spelling of the fields.
 */
export function replyFor(host: HookHost, said: HookSaid): object {
  const reply: { readonly [H in HookHost]: (said: HookSaid) => object } = {
    vscode: (s) => hookReply('PreToolUse', s),
  };
  return reply[host](said);
}
