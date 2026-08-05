/**
 * bootstrap: the opening read of a session, focused on the actor.
 *
 * When an agent starts, it needs four things: where the actor left off, what can
 * be done next, what patterns it is expected to work by, and what has already been
 * decided. bootstrap composes exactly those — {@link resume} for the "where was I"
 * (the actor's latest run and open focus), the live pieces of work for the "what
 * now", the NAMES of the adopted skills ({@link adoptedSkills}) for the "how we do
 * things here", and the NAMES of the decisions in force ({@link decisionsInForce})
 * for the "what governs here". It is the "serve lean" of the design: a filtered
 * opening context, not a dump of the whole record.
 *
 * THE FOURTH HALF IS THE ONE THAT WAS MISSING, and the measurement is what said so.
 * The product has three state machines (task, decision, skill) with two sides each
 * — what already holds, and what waits for a move — and this read served two of
 * those six cells: the waiting side of tasks and the holding side of skills.
 * Decision appeared on neither. Over a real record that held two ADRs, and nothing
 * else worth reading, the answer was `work: []`, `skills: []` — an empty answer
 * about a full record, in the exact shape this module already names as the worst
 * one an opening read can have. The cell filled here is the holding side of
 * decision; the waiting side of decision and of skill is a separate question with
 * a criterion of its own ("waits for a judgement somebody has to make"), and it is
 * NOT this list's criterion.
 *
 * NAMES, NEVER BODIES. The skills appear as name + id and nothing else, and the
 * decisions as title + `adr` + id. A body is the pattern, or the argument, in full
 * — paragraphs of it — and putting twenty of those in every session's opening
 * context would bury what matters and charge for what rarely applies. A name is one
 * line: it is both the index and the trigger, and an agent cannot ask for what it
 * does not know exists. The body comes from a separate read, when a name turns out
 * to match the task at hand: a pattern's from {@link adoptedSkills} (the `skills`
 * tool), and a decision's — its `rationale` and the `alternatives` it turned down —
 * from {@link readRecord} (the `read_record` tool).
 *
 * A TASK HAS A BODY TOO, AND IT IS THE MOVES. The same rule now governs the work
 * list, because it is the same distinction: a work item carries id, title, state
 * and when it last moved — the NAME of a piece of work — and not the moves the
 * workflow allows from it. Those moves are its body: the whole row set out of its
 * state, each action with the proof it demands, ten lines for one task. They come
 * from {@link nextActions} (or {@link nextActionsForTask}), asked about the ONE
 * task the agent decided to act on — the same second read a skill's body comes
 * through. The trade is deliberate and it is not symmetric: one extra call on the
 * path where an agent ACTS, against the whole table for every task on the path
 * where it only LOOKS.
 *
 * No count of the moves takes their place, either. Being in this list already
 * means having a legal move — the filter below drops a terminal task by
 * construction — so a number beside each item would restate the definition of the
 * list it is in.
 *
 * FILTERING WAS NOT A LIMIT, AND MEASUREMENT IS WHAT SAID SO. This doc used to
 * claim, under the heading LEAN, NOT MEASURED, that "the economy is a CONSEQUENCE
 * of serving only what matters, never a budget this layer manages". The premise
 * beneath that was that "actionable" bounds the work list. It does not: a healthy
 * backlog is mostly actionable, and excluding terminal tasks excludes almost
 * nothing. The number that falsified it was 854 — the lines of ONE payload over a
 * modest record (30 actionable tasks, 15 decisions, 25 adopted patterns, 20
 * memories, 10 observations), of which the work list alone was 742, some 25 lines
 * per task, against the ~200 lines the market publishes for a whole project
 * memory. A hundred actionable tasks would have been ~2,500 lines.
 *
 * So the limit is STATED now, in two halves, and neither of them is a tokenizer:
 *   - each item is a NAME, which is what fixes the per-item cost at a handful of
 *     fields instead of a transition table or an argument;
 *   - a list is CUT (see {@link capped}) and the answer says how many there were
 *     ({@link Bootstrap.workTotal}, {@link Bootstrap.decisionsTotal}) — a cut that
 *     does not declare itself is the same failure as an empty answer that reads
 *     like an answer.
 * What has NOT changed is the part that was right: nothing here estimates tokens
 * or measures bytes. A count of items is a property this layer can be correct
 * about; a token budget is not. Asserted in `bootstrap.test.ts` — "cuts the work
 * list at the convention's limit and says how many there were", "serves every
 * item, and no new field, below the limit", and "cuts the decisions at the same
 * limit and says how many there were".
 *
 * ONE number and ONE cut, for both lists. The limit is the search's own default
 * taken by reference (see {@link SERVED_LIMIT}), because a second number for "how
 * many items does a read hand back when nobody said" is a second convention that
 * drifts from the first; and the cut is one function ({@link capped}) rather than
 * one per list, because a slice written twice is a rule written twice.
 *
 * What still makes the rest lean is the filtering:
 *   - the actor's focus comes from `resume`, already scoped to the actor;
 *   - the work list carries ONLY actionable tasks — those with at least one legal
 *     next move (a terminal task has none and is left out) — most recently
 *     touched first, so the freshest work leads and the cut falls on the stalest;
 *   - the skill list carries ONLY adopted patterns, by name;
 *   - the decision list carries ONLY decisions in force (`accepted`), by name,
 *     most recently settled first — see {@link decisionsInForce} for why one state
 *     is the whole filter.
 *
 * AN HONEST LIMIT. The work list is workspace-wide, not the actor's own: a task
 * projection carries no `who`, so the tasks cannot be attributed to the actor
 * the way the runs can (see {@link focus}). bootstrap surfaces the actor's focus
 * (their runs) AND the workspace's actionable work — the two honest halves the
 * read model supports today. When a future slice ties a task to the actor, the
 * work list can narrow to the actor with no change to this shape.
 *
 * ONE WORLD NOW, AND THAT IS THE CORRECTION. The four halves read the SAME caches:
 * every tree the caller can see. The split used to be deliberate — skills from every
 * tree (a pattern is a capability), work and runs from the actor's single tree
 * (because "work is scoped to a tree") — and the second half of that sentence stopped
 * being true when routing became a function of the KIND. A task lands in the tree
 * that travels and a memory in the machine's own, whoever wrote either; so "the
 * actor's tree" names no tree in particular, and a work list read from one of them
 * came back EMPTY while looking like an answer. That is the worst shape an opening
 * read can have: an agent told there is nothing to do proceeds as if that were true.
 *
 * Concatenating per-tree projections is not an approximation of the union: a task's
 * whole history lands in one tree (a move follows the entity), so the per-tree fold
 * and the union fold see the same events for it. Ordering is by CONTENT
 * (`updatedAt`, then id), so which trees are passed, and in what order, cannot
 * reshuffle the list.
 */

import { type ProjectionCache, SEARCH_DEFAULT_LIMIT, type TaskProjection } from '@mnema/core';
import { type DecisionRef, decisionsInForce } from './decisions.js';
import { type ActorScope, type Resume, resume } from './focus.js';
import { nextActions } from './next-action.js';
import { adoptedSkills, type SkillRef } from './skills.js';

/**
 * How many items of ONE list an opening context serves.
 *
 * It is the search's own default, taken BY REFERENCE and not restated: that
 * constant is already this product's published answer to "how many items does a
 * read hand back when nobody said", and a second number for the same question is
 * a second convention that drifts from the first. The same reasoning makes it one
 * constant for every list here rather than one per list — the question a second
 * number would answer differently is the same question.
 */
const SERVED_LIMIT: number = SEARCH_DEFAULT_LIMIT;

/** One live piece of work, NAMED — a unit of "what can be done". */
export interface WorkItem {
  /** The task's id — the key {@link nextActionsForTask} takes. */
  readonly id: string;
  readonly title: string;
  /** The task's current state. */
  readonly state: string;
  /** `at` of its last transition — what "most recently touched" orders on. */
  readonly updatedAt: string;
}

/**
 * The opening context: where the actor is, the actionable work, the patterns to
 * work by, and the decisions that govern.
 */
export interface Bootstrap {
  /** Where the actor left off and what they have open. */
  readonly resume: Resume;
  /**
   * The workspace's actionable tasks — those with a legal next move — most
   * recently touched first, NAMED and not spelled out: the moves each one allows
   * come from {@link nextActions}, asked per task (see the module doc). Terminal
   * tasks (no move out) are omitted, and so is everything past
   * {@link Bootstrap.workTotal}'s cut. NOT attributed to the actor (see below).
   */
  readonly work: readonly WorkItem[];
  /**
   * How many actionable tasks there are in all. Greater than `work.length` means
   * the list was cut, and the items missing are the STALEST — the order is
   * freshest-first, so a cut answer is always the top of it.
   *
   * Named for the list it counts rather than called `total`, which is what the
   * one-list read this borrows the shape from ({@link searchRecords}) can afford:
   * several lists arrive here, and a bare total beside them would leave a reader to
   * guess which one it was about.
   */
  readonly workTotal: number;
  /**
   * The adopted patterns, by NAME and id — never the body (see the module doc).
   * Ordered by name, so the list is stable whatever order the trees are read in.
   */
  readonly skills: readonly SkillRef[];
  /**
   * The decisions in force — `accepted`, and nothing else — by title, `adr` label
   * and id, never the body — neither the `rationale` nor the `alternatives` (see
   * the module doc; both come from {@link readRecord}). Most recently settled
   * first, so the freshest calls lead
   * and the cut falls on the oldest, and everything past
   * {@link Bootstrap.decisionsTotal}'s cut is omitted.
   */
  readonly decisions: readonly DecisionRef[];
  /**
   * How many decisions are in force in all. Greater than `decisions.length` means
   * the list was cut, and what is missing is the OLDEST of them.
   *
   * Which is worth one warning to whoever reads this number: an old decision is not
   * a weak one. A call settled two years ago and never superseded governs exactly as
   * much as one settled today, and this cut keeps the recent end because recency is
   * the only ordering the record proves — not because age ranks authority. `search`
   * (kind `decision`, state `accepted`) reaches past it.
   */
  readonly decisionsTotal: number;
}

/**
 * Builds the opening context for `actor` over every tree the caller can see:
 * their resume, the freshest actionable tasks by name, the names of the adopted
 * patterns, and the names of the decisions in force. Reads caches only; composes
 * pure derivations. The four halves are independent — an actor with no runs still
 * gets the work list, and a record with no patterns still gets the other three.
 */
export function bootstrap(caches: readonly ProjectionCache[], scope: ActorScope): Bootstrap {
  const actionable = caches
    .flatMap((cache) => cache.listTasks())
    .map((t) => toWorkItem(t))
    .filter((w): w is WorkItem => w !== null)
    .sort(byUpdatedDesc);
  // Named, never spelled out: the body is dropped here and served by its own
  // read, so the opening context stays one line per pattern.
  const skills = adoptedSkills(caches).map(({ id, name }) => ({ id, name }));
  const work = capped(actionable);
  // The rule for which decisions govern is NOT here: it is `decisionsInForce`, so
  // the brief that serves that same derivation into a file cannot answer "in force"
  // differently. What the brief does differ in is the trees it asks about — it
  // carries only the one that travels, and it filters its own sources to do it, so
  // this answer keeps every tree the caller can see.
  const decisions = capped(decisionsInForce(caches));
  return {
    resume: resume(caches, scope),
    work: work.served,
    workTotal: work.total,
    skills,
    decisions: decisions.served,
    decisionsTotal: decisions.total,
  };
}

/**
 * What one list of an opening context serves, and how many there were — the CUT and
 * the report of it, made in one place so they cannot come to disagree.
 *
 * A cut computed here and a total computed at the call site is how a list starts
 * declaring the wrong number: the total has to be of the list BEFORE the cut, which
 * is a fact only the caller of the cut still holds.
 *
 * ONE function for every list, not one per list. Two lists are cut here and a third
 * will be; a `slice` and a `length` written per list is the same rule written that
 * many times, and the failure mode of a rule written twice is that one copy is
 * amended. What the caller still owns is naming the pair (`work`/`workTotal`,
 * `decisions`/`decisionsTotal`), and a total attached to the wrong list is caught by
 * a fixture where the two lists have DIFFERENT totals — "counts each list, and the
 * two totals are not each other's" in `bootstrap.test.ts`.
 */
function capped<T>(items: readonly T[]): {
  readonly served: readonly T[];
  readonly total: number;
} {
  return { served: items.slice(0, SERVED_LIMIT), total: items.length };
}

/**
 * A task becomes a WorkItem only if it has at least one legal next move. The moves
 * decide MEMBERSHIP and are then dropped: what a state allows is the task's body,
 * served by {@link nextActions} per task, so being in the list is the whole of what
 * this answer says about them.
 */
function toWorkItem(task: TaskProjection): WorkItem | null {
  if (nextActions(task.state).length === 0) return null;
  return {
    id: task.id,
    title: task.title,
    state: task.state,
    updatedAt: task.updatedAt,
  };
}

/** Most recently touched first; ties keep a stable (id) order. */
function byUpdatedDesc(a: WorkItem, b: WorkItem): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
