/**
 * `mnema settled`: one sentence of fact for the agent, beside the answer to a question it asked the
 * person, run by a hook after the host's question tool.
 *
 * WHAT IT IS FOR. A question the agent puts to the person, answered, is the moment a choice is most
 * often settled and the one an agent least often records: the answer arrives, the work goes on. The
 * sentence says that a question was answered, which tool records a choice, and that nothing was
 * recorded from it. It says it beside the answer, where the agent reads it next.
 *
 * IT RECORDS NOTHING, AND IT DOES NOT READ THE ANSWER. Which tool ran and in which event is all it
 * looks at: whether the answer settled anything is the agent's to judge and the person's to rule on.
 * So the channel is ON until somebody switches it off (`mnema switch off choice-settled`), unlike the
 * one reader that records from a person's words (`corrections.ts`), which starts off.
 *
 * THE QUESTION TOOLS ARE EACH HOST'S OWN NAME ({@link QUESTION_TOOLS}), in one table, so a hook that
 * fires for any other tool (VS Code runs a plugin's hooks whatever their matcher says) is answered
 * with the empty reply `{}`, as is every outcome where the product has nothing to say.
 */

import { channelIsOn } from '@mnema/context';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { CHOICE_SETTLED_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';

/** What the command needs: injected so it is testable. */
export interface SettledContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The reply for the host. */
export interface SettledDone {
  readonly ok: true;
  /** The JSON the host reads on stdout: `{}` unless the sentence is handed over. */
  readonly reply: object;
}

/**
 * The tools a host asks the person a question through, by the host's own name: Claude Code's and
 * Copilot CLI's `AskUserQuestion`, Codex's `request_user_input`, Gemini CLI's `ask_user` and
 * OpenCode's `question`. Only Claude Code's is held by a run of the host.
 */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set([
  'AskUserQuestion',
  'request_user_input',
  'ask_user',
  'question',
]);

/** The events that fire after a tool ran: Gemini CLI names it `AfterTool`, the others `PostToolUse`. */
const AFTER_A_TOOL: ReadonlySet<string> = new Set(['PostToolUse', 'AfterTool']);

/** What the agent is handed: a fact, the tool that records, and that nothing was recorded. */
export const SETTLED_SENTENCE =
  'A question to the person was answered here. Where the answer settled a choice, ' +
  '`record_decision` records it in this project’s record, with the options not taken as ' +
  '`alternatives`; nothing has been recorded from this answer.';

const SILENT: SettledDone = { ok: true, reply: {} };

/**
 * Answers the hook payload `input.payload` with the sentence, or `{}`. `reply` is the shape the host
 * reads: nested under `hookSpecificOutput` by default, or a top-level `additionalContext` (`flat`).
 */
export function runSettled(
  ctx: SettledContext,
  input: { readonly payload: string; readonly reply?: 'flat' | undefined },
): SettledDone {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.payload);
    if (typeof parsed !== 'object' || parsed === null) return SILENT;
    payload = parsed as Record<string, unknown>;
  } catch {
    return SILENT;
  }
  const event = payload['hook_event_name'];
  if (typeof event !== 'string' || !AFTER_A_TOOL.has(event)) return SILENT;
  const tool = payload['tool_name'];
  if (typeof tool !== 'string' || !QUESTION_TOOLS.has(tool)) return SILENT;

  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return SILENT;
  const on = withScopedCaches(trees, (sources) => channelIsOn(sources, CHOICE_SETTLED_CHANNEL));
  if (!on) return SILENT;
  return {
    ok: true,
    reply:
      input.reply === 'flat'
        ? { additionalContext: SETTLED_SENTENCE }
        : { hookSpecificOutput: { hookEventName: event, additionalContext: SETTLED_SENTENCE } },
  };
}
