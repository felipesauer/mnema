/**
 * bootstrap: the opening read of a session, focused on the actor.
 *
 * When an agent starts, it needs two things: where the actor left off, and what
 * can be done next. bootstrap composes exactly those — {@link resume} for the
 * "where was I" (the actor's latest run and open focus) and {@link nextActions}
 * for the "what now" (the moves each live piece of work allows). It is the
 * "serve lean" of the design: a filtered opening context, not a dump of the
 * whole record.
 *
 * LEAN, NOT MEASURED. bootstrap narrows — it does not count. There is no token
 * estimate, no size signal, no tokenizer: the economy is a CONSEQUENCE of
 * serving only what matters (the actor's focus and the actionable work), never a
 * budget this layer manages. What makes it lean is the filtering:
 *   - the actor's focus comes from `resume`, already scoped to the actor;
 *   - the work list carries ONLY actionable tasks — those with at least one legal
 *     next move (a terminal task has none and is left out) — most recently
 *     touched first, so the freshest work leads.
 *
 * AN HONEST LIMIT. The work list is workspace-wide, not the actor's own: a task
 * projection carries no `who`, so the tasks cannot be attributed to the actor
 * the way the runs can (see {@link focus}). bootstrap surfaces the actor's focus
 * (their runs) AND the workspace's actionable work — the two honest halves the
 * read model supports today. When a future slice ties a task to the actor, the
 * work list can narrow to the actor with no change to this shape.
 */

import type { ProjectionCache, TaskProjection } from '@mnema/core';
import { type ActorScope, type Resume, resume } from './focus.js';
import { type NextAction, nextActions } from './next-action.js';

/** One live task and the moves it allows — a unit of "what can be done". */
export interface WorkItem {
  /** The task's id. */
  readonly id: string;
  readonly title: string;
  /** The task's current state. */
  readonly state: string;
  /** `at` of its last transition — what "most recently touched" orders on. */
  readonly updatedAt: string;
  /** The moves the workflow allows from this state (always non-empty here). */
  readonly actions: readonly NextAction[];
}

/** The opening context: where the actor is, and the actionable work. */
export interface Bootstrap {
  /** Where the actor left off and what they have open. */
  readonly resume: Resume;
  /**
   * The workspace's actionable tasks — those with a legal next move — most
   * recently touched first, each carrying its available moves. Terminal tasks
   * (no move out) are omitted. NOT attributed to the actor (see the module doc).
   */
  readonly work: readonly WorkItem[];
}

/**
 * Builds the opening context for `actor`: their resume, plus every actionable
 * task with the moves it allows, freshest first. Reads the cache only; composes
 * pure derivations. An actor with no runs still gets the workspace's work list —
 * the two halves are independent.
 */
export function bootstrap(cache: ProjectionCache, scope: ActorScope): Bootstrap {
  const work = cache
    .listTasks()
    .map((t) => toWorkItem(t))
    .filter((w): w is WorkItem => w !== null)
    .sort(byUpdatedDesc);
  return { resume: resume(cache, scope), work };
}

/** A task becomes a WorkItem only if it has at least one legal next move. */
function toWorkItem(task: TaskProjection): WorkItem | null {
  const actions = nextActions(task.state);
  if (actions.length === 0) return null;
  return {
    id: task.id,
    title: task.title,
    state: task.state,
    updatedAt: task.updatedAt,
    actions,
  };
}

/** Most recently touched first; ties keep a stable (id) order. */
function byUpdatedDesc(a: WorkItem, b: WorkItem): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
