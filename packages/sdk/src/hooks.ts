/**
 * The hooks of a program built on the Claude Agent SDK, for the record.
 *
 * `options.hooks` of `query()` takes, per event, a list of `{ matcher?, hooks: [callback] }`
 * and each callback is `(input, toolUseID, { signal }) => Promise<output>`, the output being
 * `{ hookSpecificOutput: { hookEventName, … } }` or `{}` for nothing to say
 * (https://code.claude.com/docs/en/agent-sdk/hooks). What is returned here is that value, so
 * `query({ prompt, options: { hooks: mnemaHooks({ … }) } })` is the whole registration.
 *
 * Both callbacks are the plugin's own handlers over the same functions, not a second copy of them:
 *
 *   - `SessionStart` hands over the document `mnema brief --hook` prints, as `additionalContext`,
 *     and under it what the same read says about a record that does not chain.
 *     Where there is no project, the channel is switched off, or the record will not read, the
 *     reply is `{}`: a session that opened with nothing is what each of those asks for.
 *   - `PreToolUse` on `Write`, `Edit` and `NotebookEdit` asks what `mnema before-a-write` asks
 *     (`runBeforeAPath`): `deny` citing the rule where a rule of the record refuses a write at the
 *     path, `ask` where one asks for a person, `{}` otherwise. The facts it records, it records
 *     before it answers.
 *
 * It does not carry what the plugin's Claude Code door hands beside a write — the rules that only
 * govern the path — for the reason `before-a-write` does not: a hook that runs per write
 * remembers no run.
 */

import { resolve } from 'node:path';
import {
  briefWithin,
  discoveryEnv,
  hookReply,
  linkBreakNotice,
  renderPlain,
  roomBeside,
  runBeforeAPath,
  runBrief,
} from '@mnema/code/library';
import type { DiscoveryEnv } from '@mnema/core';

/** What a callback gets of the event: only the fields this module reads. */
export interface HookInput {
  /** The working directory the session runs in, which every hook input carries. */
  readonly cwd?: string;
  readonly tool_name?: string;
  readonly tool_input?: unknown;
}

/** What a callback answers: `{}` for nothing to say. */
export type HookOutput = object;

/** The Agent SDK's callback shape. */
export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { readonly signal: AbortSignal },
) => Promise<HookOutput>;

/** One entry of the list an event takes. */
export interface HookMatcher {
  readonly matcher?: string;
  readonly hooks: readonly HookCallback[];
}

/** What `query()` takes as `options.hooks`, for the two events used. */
export interface MnemaHooks {
  readonly SessionStart: readonly HookMatcher[];
  readonly PreToolUse: readonly HookMatcher[];
}

/** Which tools write a file, as the plugin declares them for the same host. */
export const WRITE_TOOLS_MATCHER = 'Write|Edit|NotebookEdit';

/** The name the facts a hook records are attributed to when none is given. */
export const DEFAULT_HOOK_AGENT = 'claude-agent-sdk';

/** Where the hooks read the record, and who they record as. */
export interface HookOptions {
  /** The directory the project is found from, when the event does not carry one. */
  readonly cwd: string;
  /** The name the facts a hook records are attributed to. */
  readonly agent?: string;
  /** `$HOME` and `$MNEMA_HOME`. Defaults to this process's. */
  readonly env?: DiscoveryEnv;
}

/** The path a write tool names: `file_path`, or `notebook_path` for a notebook. */
function pathOf(toolInput: unknown): string | undefined {
  if (typeof toolInput !== 'object' || toolInput === null) return undefined;
  const named = toolInput as Record<string, unknown>;
  for (const key of ['file_path', 'notebook_path']) {
    const value = named[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** The hooks to register: the opening document at `SessionStart`, the rules before a write. */
export function mnemaHooks(options: HookOptions): MnemaHooks {
  const env = options.env ?? discoveryEnv();
  const which = options.agent ?? DEFAULT_HOOK_AGENT;
  const whereFor = (input: HookInput) => ({ cwd: input.cwd ?? options.cwd, env });

  const opening: HookCallback = async (input) => {
    const result = runBrief(whereFor(input), { outside: true });
    if (!result.ok) return {};
    // WHAT THE PLUGIN'S HANDLER DOES: the notice about a record that does not chain goes under
    // the document after a blank line, and counts against the room the host leaves.
    const notice = linkBreakNotice(result.linkBreaks).map((line) => renderPlain(line));
    const document = briefWithin(result.brief, roomBeside(notice), result.outside).join('\n');
    const said = notice.length === 0 ? document : `${document}\n\n${notice.join('\n')}`;
    return hookReply('SessionStart', { context: said });
  };

  const beforeAWrite: HookCallback = async (input) => {
    const path = pathOf(input.tool_input);
    if (path === undefined) return {};
    const where = whereFor(input);
    return runBeforeAPath(where, {
      which,
      paths: [resolve(where.cwd, path)],
      asks: true,
      reply: (said) => hookReply('PreToolUse', said),
    }).reply;
  };

  return {
    SessionStart: [{ hooks: [opening] }],
    PreToolUse: [{ matcher: WRITE_TOOLS_MATCHER, hooks: [beforeAWrite] }],
  };
}
