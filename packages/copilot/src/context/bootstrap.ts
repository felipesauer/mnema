/**
 * bootstrap: the opening read of a session, focused on the actor.
 *
 * When an agent starts, it needs three things: where the actor left off, what
 * can be done next, and what patterns it is expected to work by. bootstrap
 * composes exactly those — {@link resume} for the "where was I" (the actor's
 * latest run and open focus), {@link nextActions} for the "what now" (the moves
 * each live piece of work allows), and the NAMES of the adopted skills
 * ({@link adoptedSkills}) for the "how we do things here". It is the "serve
 * lean" of the design: a filtered opening context, not a dump of the whole
 * record.
 *
 * NAMES, NEVER BODIES. The skills appear as name + id and nothing else. A body
 * is the pattern in full — paragraphs of it — and putting twenty of those in
 * every session's opening context would bury what matters and charge for what
 * rarely applies. A name is one line: it is both the index and the trigger, and
 * an agent cannot ask for what it does not know exists. The body comes from a
 * separate read, when a name turns out to match the task at hand.
 *
 * LEAN, NOT MEASURED. bootstrap narrows — it does not count. There is no token
 * estimate, no size signal, no tokenizer: the economy is a CONSEQUENCE of
 * serving only what matters (the actor's focus, the actionable work, the names
 * of the patterns), never a budget this layer manages. What makes it lean is the
 * filtering:
 *   - the actor's focus comes from `resume`, already scoped to the actor;
 *   - the work list carries ONLY actionable tasks — those with at least one legal
 *     next move (a terminal task has none and is left out) — most recently
 *     touched first, so the freshest work leads;
 *   - the skill list carries ONLY adopted patterns, by name.
 *
 * AN HONEST LIMIT. The work list is workspace-wide, not the actor's own: a task
 * projection carries no `who`, so the tasks cannot be attributed to the actor
 * the way the runs can (see {@link focus}). bootstrap surfaces the actor's focus
 * (their runs) AND the workspace's actionable work — the two honest halves the
 * read model supports today. When a future slice ties a task to the actor, the
 * work list can narrow to the actor with no change to this shape.
 *
 * TWO WORLDS, DELIBERATELY. The resume and the work come from ONE cache — the
 * actor's tree, because work is scoped to a tree and always was. The skills come
 * from every tree the caller can see, because a pattern is a capability, not a
 * piece of work: the team adopts patterns in the public tree and an agent's own
 * land in the private one, and both apply to whatever is being done. The caller
 * says which caches those are; passing `[cache]` alone is the honest answer when
 * the actor's tree is the whole world.
 */

import type { ProjectionCache, TaskProjection } from '@mnema/core';
import { type ActorScope, type Resume, resume } from './focus.js';
import { type NextAction, nextActions } from './next-action.js';
import { adoptedSkills, type SkillRef } from './skills.js';

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

/** The opening context: where the actor is, the actionable work, the patterns. */
export interface Bootstrap {
  /** Where the actor left off and what they have open. */
  readonly resume: Resume;
  /**
   * The workspace's actionable tasks — those with a legal next move — most
   * recently touched first, each carrying its available moves. Terminal tasks
   * (no move out) are omitted. NOT attributed to the actor (see the module doc).
   */
  readonly work: readonly WorkItem[];
  /**
   * The adopted patterns, by NAME and id — never the body (see the module doc).
   * Ordered by name, so the list is stable whatever order the trees are read in.
   */
  readonly skills: readonly SkillRef[];
}

/**
 * Builds the opening context for `actor`: their resume, every actionable task
 * with the moves it allows (freshest first), and the names of the adopted
 * patterns found in `skillCaches`. Reads caches only; composes pure derivations.
 * The three halves are independent — an actor with no runs still gets the work
 * list, and a workspace with no skills still gets both of the others.
 */
export function bootstrap(
  cache: ProjectionCache,
  scope: ActorScope,
  skillCaches: readonly ProjectionCache[],
): Bootstrap {
  const work = cache
    .listTasks()
    .map((t) => toWorkItem(t))
    .filter((w): w is WorkItem => w !== null)
    .sort(byUpdatedDesc);
  // Named, never spelled out: the body is dropped here and served by its own
  // read, so the opening context stays one line per pattern.
  const skills = adoptedSkills(skillCaches).map(({ id, name }) => ({ id, name }));
  return { resume: resume(cache, scope), work, skills };
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
