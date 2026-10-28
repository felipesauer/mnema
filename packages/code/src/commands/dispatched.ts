/**
 * `mnema dispatched`: what a session handed to other agents, kept in the record as one private task
 * with a handoff for each dispatch, for a `PostToolUse` hook on Claude Code's `Agent` tool and for
 * its `SessionEnd`.
 *
 * ONE TASK PER SESSION. The first dispatch of a session opens a PRIVATE task, "Work handed over in this
 * session" and the instant, moved to in progress; every dispatch records a private handoff on it,
 * from `orchestrator` to the subagent type the call named, with a brief that is the call's short
 * description and, when the prompt cites a file that exists, that file's path. The end of the session
 * moves the task to done, with the number of handoffs as its note. The task's id and the count live in
 * the session journal (`session-journal.ts`), the one file this machine keeps per session: no second
 * mechanism, and a session whose journal switch is off is a session this does nothing for.
 *
 * THE PROMPT IS NEVER RECORDED. A prompt is the longest text a session writes and it can hold anything
 * the person pasted; the record gets the description the host's own call carries (a few words the
 * model wrote to label the dispatch), and a PATH. The text behind a path is the file's, in the
 * project, where it is read from.
 *
 * A RESUMED SESSION KEEPS ITS TASK: the host hands the same session id, the journal names the task,
 * and a dispatch after the end moves it out of done again (reopen) instead of starting a second.
 * A session that ended with no `SessionEnd` (a killed terminal) leaves its task in progress; the next
 * session that dispatches in the project BLOCKS the ones whose journal has been untouched for a day, with
 * a reason that says the outcome is unknown: a session nobody saw end is not a success. If it comes back,
 * the dispatch unblocks the task, and its end completes it.
 *
 * A HOST RUNS IT AND IT NEVER FAILS THE HOST: every outcome is the empty reply `{}`, and what could
 * not be done is a note on the second stream. Nothing is printed to the model, and a failure of the
 * mirror never holds a dispatch.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { channelIsOn } from '@mnema/context';
import { type DiscoveryEnv, type ResolvedTrees, resolveTrees } from '@mnema/core';
import { AGENT_MIRROR_CHANNEL, SESSION_JOURNAL_CHANNEL } from '../record-framing.js';
import {
  countASkip,
  exclusivelyOn,
  type HandedOver,
  type Journal,
  journalFile,
  leftOpen,
  readingOf,
  readJournal,
  sessionIdOf,
  skippedOf,
  writeJournal,
} from '../session-journal.js';
import { withScopedCaches } from '../tree-sources.js';
import { runHandoff } from './handoff.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

/** What the command needs: injected so it is testable. */
export interface DispatchedContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
  /** The agent `MNEMA_AGENT_KEY` named, for the signature of what is written. */
  readonly agentKey?: string;
  /** The instant, injected so a test names it. */
  readonly now?: Date;
  /** How long a held lock on the session's journal is waited for, in milliseconds: a test shortens it. */
  readonly lockWaitMs?: number;
}

/** The reply for the host, and what the run has to say beside it. */
export interface DispatchedDone {
  readonly ok: true;
  /** The JSON the host reads on stdout: always `{}`. */
  readonly reply: object;
  /** Lines for the second stream: what could not be done, and why. */
  readonly notes: readonly string[];
}

/** The two events this answers, and the tools, by the names the host gives them in the payload. */
const AFTER_A_TOOL = 'PostToolUse';
const THE_END = 'SessionEnd';
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);

/** Who hands the work over. */
export const ORCHESTRATOR = 'orchestrator';

/** What a call that names no subagent type is handed to. */
const ANY_SUBAGENT = 'subagent';

/** The longest description kept: the host's own is a few words, and this is a ceiling. */
const MAX_DESCRIPTION = 200;

/** The empty reply, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): DispatchedDone {
  return { ok: true, reply: {}, notes };
}

/** A field of an object, when it is a string. */
function text(of: unknown, key: string): string | undefined {
  if (typeof of !== 'object' || of === null) return undefined;
  const value = (of as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** The title of a session's task: no content, only when it began. */
export function titleOfTheTask(now: Date): string {
  return `Work handed over in this session, ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** A word of a prompt that has the shape of a path to a text file. */
const A_PATH =
  /(?:^|[\s"'`(<[=])((?:\.{1,2}\/|\/|~\/)?[\w@.+-]+(?:\/[\w@.+-]+)*\.(?:md|txt|json|ya?ml))(?=$|[\s"'`)>\],.;:])/g;

/** How many candidate words of a prompt are looked for on disk: it is the head of a prompt that cites. */
const CANDIDATES = 12;

/**
 * The first path in `prompt` that is a file on disk, as the project knows it: relative to the
 * project when inside it, absolute otherwise. Never the prompt, and never a path that is not a file.
 */
export function briefFileOf(prompt: string, cwd: string, root: string): string | undefined {
  let seen = 0;
  for (const found of prompt.matchAll(A_PATH)) {
    if (seen++ >= CANDIDATES) break;
    const word = found[1];
    if (word === undefined || word.startsWith('~')) continue;
    const absolute = isAbsolute(word) ? resolve(word) : resolve(cwd, word);
    try {
      if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    } catch {
      continue;
    }
    const inside = relative(root, absolute);
    return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? absolute : inside;
  }
  return undefined;
}

/** The brief of one handoff: the short description, and the file the prompt cites when one is there. */
export function briefOf(description: string | undefined, file: string | undefined): string {
  const said = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
  const parts = [said === '' ? 'Work handed to a subagent.' : said];
  if (file !== undefined) parts.push(`Brief in the file: ${file}`);
  return parts.join('\n\n');
}

/** The journal with the task in it: the one there was, or one with nothing but the task. */
function journalOf(
  session: string,
  previous: Journal | undefined,
  now: Date,
  handedOver: HandedOver,
): Journal {
  if (previous !== undefined) return { ...previous, updatedAt: now.toISOString(), handedOver };
  return {
    version: 1,
    session,
    updatedAt: now.toISOString(),
    openedAt: null,
    decisions: [],
    notes: [],
    questionsWithoutDecision: 0,
    decisionFilesUncited: 0,
    filesEdited: 0,
    tasksInProgress: [],
    runsOpen: [],
    trees: { public: { goal: null, outcome: null }, private: { goal: null, outcome: null } },
    reading: readingOf(undefined),
    handedOver,
  };
}

/** The hook's payload as an object, or undefined. */
function parsed(payload: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether both switches this depends on are on, asked of the record. */
function mirrorIsOn(trees: ResolvedTrees): boolean {
  return withScopedCaches(
    trees,
    (sources) =>
      channelIsOn(sources, AGENT_MIRROR_CHANNEL) && channelIsOn(sources, SESSION_JOURNAL_CHANNEL),
  );
}

/** What a refusal says, in one phrase. */
function refusal(refused: { readonly reason: string; readonly message?: string }): string {
  return refused.message ?? refused.reason;
}

/** The writes of this command: where it runs, and the agent asked for. */
function writes(ctx: DispatchedContext): {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  readonly agentKey?: string;
} {
  return {
    cwd: ctx.cwd,
    env: ctx.env,
    ...(ctx.agentKey !== undefined ? { agentKey: ctx.agentKey } : {}),
  };
}

/** Moves the task, in the tree it was born in. The refusal comes back as a note. */
function move(
  ctx: DispatchedContext,
  id: string,
  action: string,
  proof: { reason?: string; note?: string },
): string | undefined {
  const moved = runTaskTransition(writes(ctx), { id, action, proof });
  return moved.ok
    ? undefined
    : `The task ${id} could not be moved (${action}): ${refusal(moved as { reason: string; message?: string })}`;
}

/** The note a session's task is closed with: counts and nothing else. */
function closingNote(handoffs: number, skipped: number): string {
  return (
    `${handoffs} ${handoffs === 1 ? 'handoff' : 'handoffs'} recorded in this session.` +
    (skipped === 0
      ? ''
      : ` ${skipped} ${skipped === 1 ? 'dispatch was' : 'dispatches were'} not mirrored.`)
  );
}

/**
 * The reason a swept session's task is blocked with: what is known and no more. The session stopped
 * with no `SessionEnd`, so nobody saw how it ended: this says so, when it was last seen, and the count.
 */
function sweptReason(handoffs: number, skipped: number, lastSeen: string): string {
  return (
    `The session stopped with no end, so how it ended is unknown. It was last seen at ${lastSeen}; ` +
    `${handoffs} ${handoffs === 1 ? 'handoff was' : 'handoffs were'} recorded in it.` +
    (skipped === 0
      ? ''
      : ` ${skipped} ${skipped === 1 ? 'dispatch was' : 'dispatches were'} not mirrored.`)
  );
}

/** Opens the session's task: private, submitted and started. */
function openTheTask(ctx: DispatchedContext, now: Date): { id?: string; notes: string[] } {
  const created = runTask(writes(ctx), { title: titleOfTheTask(now), scope: 'private' });
  if (!created.ok) {
    return {
      notes: [
        `The session's task was not opened: ${refusal(created as { reason: string; message?: string })}`,
      ],
    };
  }
  const notes: string[] = [];
  for (const action of ['submit', 'start']) {
    const refused = move(ctx, created.id, action, {});
    if (refused !== undefined) notes.push(refused);
  }
  return { id: created.id, notes };
}

/** One dispatch: the task when it is the first, and the handoff. */
function dispatched(
  ctx: DispatchedContext,
  trees: ResolvedTrees,
  payload: Record<string, unknown>,
  session: string,
): DispatchedDone {
  if (trees.projectPublic === undefined) return silent();
  if (!mirrorIsOn(trees)) return silent();
  const file = journalFile(trees, session);
  if (file === undefined) return silent();
  const now = ctx.now ?? new Date();
  const input = payload['tool_input'];
  const brief = briefOf(
    text(input, 'description'),
    briefFileOf(text(input, 'prompt') ?? '', ctx.cwd, dirname(trees.projectPublic)),
  );
  const to = (text(input, 'subagent_type') ?? '').trim() || ANY_SUBAGENT;

  const done = exclusivelyOn(
    file,
    (): DispatchedDone => {
      const notes: string[] = [];
      const previous = readJournal(file);
      let held = previous?.handedOver;
      if (held === undefined) {
        const opened = openTheTask(ctx, now);
        notes.push(...opened.notes);
        if (opened.id === undefined) return silent(notes);
        held = { task: opened.id, handoffs: 0, closed: false };
        notes.push(...sweepTheLeft(ctx, trees, file, now));
      } else if (held.closed) {
        // A task the sweep blocked is unblocked; one the end completed is reopened.
        const refused =
          held.swept === true
            ? move(ctx, held.task, 'unblock', {})
            : move(ctx, held.task, 'reopen', { reason: 'The session went on after it ended.' });
        if (refused !== undefined) notes.push(refused);
      }
      const recorded = runHandoff(writes(ctx), {
        task: held.task,
        fromAgent: ORCHESTRATOR,
        toAgent: to,
        brief,
        scope: 'private',
      });
      if (!recorded.ok) {
        notes.push(
          `The handoff to ${to} was not recorded: ${refusal(recorded as { reason: string; message?: string })}`,
        );
      }
      const handoffs = held.handoffs + (recorded.ok ? 1 : 0);
      writeJournal(
        file,
        journalOf(session, previous, now, { task: held.task, handoffs, closed: false }),
        now,
      );
      return silent(notes);
    },
    ctx.lockWaitMs,
  );
  if (done !== undefined) return done;
  // THE LOCK WAS NOT HAD: the mirror says nothing to the record, which opens no task and records no
  // handoff it could not tie to the one task of the session, and it counts the skip so the end of the
  // session can say it.
  countASkip(file);
  return silent([
    `A dispatch to ${to} was not mirrored: another process held this session's journal. Nothing was recorded.`,
  ]);
}

/** The end of the session: the task goes to done with the count. */
function ended(ctx: DispatchedContext, trees: ResolvedTrees, session: string): DispatchedDone {
  if (trees.projectPublic === undefined) return silent();
  const file = journalFile(trees, session);
  if (file === undefined) return silent();
  if (!mirrorIsOn(trees)) return silent();
  const now = ctx.now ?? new Date();
  const done = exclusivelyOn(
    file,
    (): DispatchedDone => {
      const previous = readJournal(file);
      const held = previous?.handedOver;
      if (held === undefined) return silent();
      // A closed task is done with, except one the sweep blocked: its session came back and ended
      // with a word, so the sweep's "how it ended is unknown" is no longer true.
      if (held.closed && held.swept !== true) return silent();
      const unblocked = held.swept === true ? move(ctx, held.task, 'unblock', {}) : undefined;
      const refused =
        unblocked ??
        move(ctx, held.task, 'complete', { note: closingNote(held.handoffs, skippedOf(file)) });
      const { swept: _swept, ...rest } = held;
      writeJournal(
        file,
        journalOf(session, previous, now, refused === undefined ? { ...rest, closed: true } : held),
        now,
      );
      return silent(refused === undefined ? [] : [refused]);
    },
    ctx.lockWaitMs,
  );
  return (
    done ??
    silent([
      'The end of the session was not mirrored: another process held its journal. The task stays in progress, and a later session that dispatches in this project blocks it once this journal has been untouched for a day.',
    ])
  );
}

/**
 * Blocks the tasks other sessions of this project left in progress: those whose journal has been
 * untouched for a day and still names a task not closed ended with no `SessionEnd`.
 */
function sweepTheLeft(
  ctx: DispatchedContext,
  trees: ResolvedTrees,
  own: string,
  now: Date,
): string[] {
  const notes: string[] = [];
  for (const left of leftOpen(trees, own, now)) {
    // BLOCKED, never DONE: a session nobody saw end has no outcome to call a success, and `unblock`
    // costs nothing when it turns out to be alive.
    const refused = move(ctx, left.held.task, 'block', {
      reason: sweptReason(left.held.handoffs, skippedOf(left.file), left.journal.updatedAt),
    });
    if (refused !== undefined) notes.push(refused);
    else
      writeJournal(
        left.file,
        { ...left.journal, handedOver: { ...left.held, closed: true, swept: true } },
        now,
      );
  }
  return notes;
}

/** Answers the hook payload `input.payload`: a task and a handoff, the task's end, or `{}`. */
export function runDispatched(
  ctx: DispatchedContext,
  input: { readonly payload: string },
): DispatchedDone {
  const payload = parsed(input.payload);
  if (payload === undefined) {
    return silent(['The hook input was not JSON, so nothing was mirrored.']);
  }
  const event = payload['hook_event_name'];
  if (event !== AFTER_A_TOOL && event !== THE_END) return silent();
  if (event === AFTER_A_TOOL && !DISPATCH_TOOLS.has(String(payload['tool_name']))) return silent();
  const session = sessionIdOf(payload['session_id']);
  if (session === undefined) return silent();
  try {
    const trees = resolveTrees(ctx.cwd, ctx.env);
    return event === THE_END
      ? ended(ctx, trees, session)
      : dispatched(ctx, trees, payload, session);
  } catch (error) {
    return silent([
      `The mirror of the dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}
