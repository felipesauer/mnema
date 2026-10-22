/**
 * The LOCAL COUNT of the tool calls an MCP server answered: one line a call, in a file on this
 * machine, read back by `mnema usage --tools`.
 *
 * OUTSIDE THE RECORD, AND THAT IS THE DESIGN. No event is written, nothing is signed, `verify`
 * never reads the file and no format changes. Whether an agent uses a tool is not a fact about
 * the work, and a record that is permanent and cloned would carry a log of habits for good. So
 * the count is a plain file in the machine's data directory (`~/.mnema`, or `$MNEMA_HOME`), the
 * one that already holds the key root, the agents' keys and the global tree, in a directory of its
 * own beside them and not inside the global tree: that one is a chain, and the product's guards
 * digest its files to tell that a refusal left it as it was. One file per project, in the home, so
 * the file is never in the repository, never in a tree that travels and never staged by a commit.
 *
 * ONE FILE PER PROJECT, NAMED BY A DIGEST OF THE PROJECT'S PRIVATE TREE. That path is the one
 * place the product already says "this project on this machine": every worktree of a repository
 * resolves to the same one and a separate clone to its own. A digest and not the path because a
 * path is a file name only until it is too long to be one.
 *
 * A LINE HOLDS FOUR FIELDS AND NO MORE: the instant, the tool's name, whether the tool's
 * declaration says it writes (`mutates`) or only reads (`reads`), and `ok` or the code of the
 * refusal. NEVER the arguments, never a word the agent wrote and never the id of a record: what
 * a call said is the record's business, and a count that held it would be a second, unsigned
 * copy of the record.
 *
 * IT COUNTS ONLY WHAT THIS SERVER ON THIS MACHINE ANSWERED. A call another host or another
 * machine answered is not here, and neither is any use of the product outside the MCP. The
 * reading says so.
 *
 * A FAILURE TO WRITE IS SWALLOWED. A tool never fails because of its own count, and the line is
 * written after the reply has gone ({@link countToolCall}), so the count never slows an answer.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ResolvedTrees } from '@mnema/core';
import type { RecordEffect } from './record-effect.js';

/** The directory, under the machine data directory, that holds one file per project. */
export const TOOL_CALLS_DIR = 'tool-calls';

/** One answered call, as a line of the file. */
export interface ToolCall {
  /** When the call was answered, ISO 8601. */
  readonly at: string;
  /** The tool's name. */
  readonly tool: string;
  /** What the tool's declaration says it may do. */
  readonly effect: RecordEffect;
  /** `ok`, or the code of the refusal. */
  readonly result: string;
}

/** What a result is called when a tool refused or failed without a code of its own. */
export const UNCODED_FAILURE = 'error';

/**
 * The file this project's calls are counted in, or undefined outside a project: a call outside
 * one has no project to be counted for, and the count is per project.
 */
export function toolCallsFile(trees: ResolvedTrees): string | undefined {
  const digest = projectDigest(trees);
  return digest === undefined ? undefined : join(dirname(trees.global), TOOL_CALLS_DIR, `${digest}.jsonl`);
}

/**
 * The name this project goes by in the machine's data directory: a digest of its private tree's
 * path, or undefined outside a project. The one place the files that are "per project, on this
 * machine" (the count of tool calls, the session journals) agree on what that means.
 */
export function projectDigest(trees: ResolvedTrees): string | undefined {
  if (trees.projectPrivate === undefined) return undefined;
  return createHash('sha256').update(trees.projectPrivate).digest('hex').slice(0, 16);
}

/**
 * The result a tool's reply stands for: `ok`, or the code a refusal carries
 * (`Refused (CODE): …`, the one line every refusal opens with).
 */
export function resultOf(reply: unknown): string {
  const flagged = reply as { isError?: unknown; content?: unknown };
  if (flagged.isError !== true) return 'ok';
  const first = Array.isArray(flagged.content) ? (flagged.content[0] as { text?: unknown }) : null;
  const code =
    typeof first?.text === 'string' ? /^Refused \(([A-Z][A-Z0-9_]*)\)/.exec(first.text) : null;
  return code?.[1] ?? UNCODED_FAILURE;
}

/** Appends one line for `call` to `file`. Never throws: see the head of this file. */
export function appendToolCall(file: string, call: ToolCall): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(
      file,
      `${JSON.stringify({ at: call.at, tool: call.tool, effect: call.effect, result: call.result })}\n`,
    );
  } catch {
    // The count is a convenience: losing a line is the honest cost of never failing a call.
  }
}

/** The lines that wait to be written: a call is answered first and counted right after. */
const waiting: { readonly file: string; readonly call: ToolCall }[] = [];
let exitHooked = false;

/**
 * Counts `call` AFTER the reply it belongs to has been handed to the host: the line is written in
 * the next turn of the event loop and not in the one that answers, so the count adds nothing to
 * the time a tool takes to answer. {@link flushToolCalls} writes what waits, and it runs when the
 * process exits, when the server closes its session (the end of stdin, SIGTERM, SIGINT) and
 * before the count is read. A process killed by SIGKILL, which no handler sees, can lose the
 * lines still waiting, which is the time between a reply and the next turn of the event loop.
 * Never throws, like {@link appendToolCall}.
 */
export function countToolCall(file: string, call: ToolCall): void {
  waiting.push({ file, call });
  if (!exitHooked) {
    exitHooked = true;
    process.once('exit', flushToolCalls);
  }
  if (waiting.length === 1) setImmediate(flushToolCalls);
}

/** Writes every line that waits, in the order the calls were answered. */
export function flushToolCalls(): void {
  for (const next of waiting.splice(0)) appendToolCall(next.file, next.call);
}

/** What reading the file gave: the calls, and how many lines were not one. */
export interface ToolCallsRead {
  readonly calls: readonly ToolCall[];
  /** Lines that are not a call as written here (a torn write, a hand edit). */
  readonly passedOver: number;
}

/** Reads every call in `file`; a file that is not there holds no calls. */
export function readToolCalls(file: string): ToolCallsRead {
  // What this process answered and has not written yet is read too: a reading never misses a call
  // the same process has already counted.
  flushToolCalls();
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return { calls: [], passedOver: 0 };
  }
  const calls: ToolCall[] = [];
  let passedOver = 0;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const call = parsed(line);
    if (call === undefined) passedOver += 1;
    else calls.push(call);
  }
  return { calls, passedOver };
}

function parsed(line: string): ToolCall | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    const { at, tool, effect, result } = value;
    if (typeof at !== 'string' || typeof tool !== 'string' || typeof result !== 'string') {
      return undefined;
    }
    if (effect !== 'mutates' && effect !== 'reads') return undefined;
    return { at, tool, effect, result };
  } catch {
    return undefined;
  }
}

/** One tool's line of the reading. */
export interface ToolTally {
  readonly tool: string;
  readonly effect: RecordEffect;
  readonly calls: number;
  /** Calls whose result is not `ok`. */
  readonly refused: number;
  readonly first: string;
  readonly last: string;
}

/** The calls grouped by tool: most called first, then by name. */
export function tallyToolCalls(calls: readonly ToolCall[]): ToolTally[] {
  const byTool = new Map<string, ToolTally>();
  for (const call of calls) {
    const soFar = byTool.get(call.tool);
    byTool.set(call.tool, {
      tool: call.tool,
      effect: call.effect,
      calls: (soFar?.calls ?? 0) + 1,
      refused: (soFar?.refused ?? 0) + (call.result === 'ok' ? 0 : 1),
      first: soFar === undefined || call.at < soFar.first ? call.at : soFar.first,
      last: soFar === undefined || call.at > soFar.last ? call.at : soFar.last,
    });
  }
  return [...byTool.values()].sort((a, b) => b.calls - a.calls || (a.tool < b.tool ? -1 : 1));
}
