/**
 * tasks: the work that is still live, and the work that awaits a verdict.
 *
 * The task machine's two halves of the opening context, in the module that owns that
 * machine's reads — the shape `decisions.ts` and `skills.ts` already have, arrived at
 * from the other direction: those two were born beside their table, and this one was
 * a filter written inline in the composition (`bootstrap.ts`) where nothing could
 * compare it to the classification standing next to it.
 *
 * ONE TABLE SAYS WHICH IS WHICH, and for this machine the table is `core`'s
 * (`TASK_DISPOSITION`, derived from `TRANSITIONS` and cross-checked against it
 * there). It is asked through {@link taskDisposition}, never copied: a set of states
 * written out here would be a second classification of the task machine, in the one
 * package that must not have one.
 *
 * LIVE WORK IS `advancing` OR `stalled` — the two dispositions that still have
 * something to do about them. `advancing` is a way forward that costs nothing but the
 * move (`DRAFT`, `READY`, `IN_PROGRESS`); `stalled` is the position that cannot
 * progress at all (`BLOCKED`), and a blocked task is precisely what somebody needs to
 * see. The other three are out, each for a reason the classification already states:
 * `awaiting-judgement` is a verdict somebody owes and belongs on the other list,
 * `settled` arrived, and `closed` is over.
 *
 * THE PREMISE THIS FALSIFIES WAS "HAS AT LEAST ONE LEGAL MOVE", and it was written
 * here in code and in three module docs as the work list's rule. It is a proxy for
 * the disposition and it is a false one: `reopen` is legal from `DONE`
 * (`TRANSITIONS`) and nothing makes it happen, so under that rule a completed task
 * was live work FOREVER. The same argument was already written down against the same
 * rule twice over — `decisions.ts` and `skills.ts` both explain that `supersede` and
 * `deprecate` stay legal on a settled record, so "has a legal move" cannot be the
 * criterion for a waiting list — and neither noticed that the machine the rule came
 * FROM had the identical hole. What surfaced it was a person reading the list on a
 * terminal: `5 actionable task(s)`, and one of them said `(DONE)`. Asserted in
 * `tasks.test.ts` — "a DONE task is not live work, though `reopen` stays legal from
 * it forever".
 *
 * WHAT AWAITS A JUDGEMENT IS `awaiting-judgement`, THE SAME WORD THE OTHER TWO
 * MACHINES ANSWER WITH. `IN_REVIEW` is classified that way in `core` — both exits
 * (`approve`, `request_changes`) require a proof field, so every way out is a verdict
 * somebody owes — and the opening context's waiting list simply did not ask. A task
 * submitted for review appeared as one more line of work to pick up, next to tasks
 * nobody was waiting on, and the list of what a person owes a ruling on did not
 * mention it. Asserted in `tasks.test.ts` — "a task IN_REVIEW awaits a judgement, and
 * is not live work".
 *
 * THE TWO LISTS THEREFORE DO NOT OVERLAP, and that is a property of the
 * classification rather than of these two functions: a state has ONE disposition, and
 * the two selections below name disjoint sets of them. `DONE` and `CANCELED` are on
 * neither, which is the sixth cell of the opening read's table left deliberately
 * empty (see `bootstrap.ts`): a task that has arrived is terminal for the purpose of
 * this read, and there is nothing to be done about it.
 *
 * ONE READ EACH, AND THEY ARE NOT THE SAME READ — which is a measurement and not a
 * taste. Both neighbouring modules ask the INDEX, one statement per state, on the
 * argument that listing everything and filtering in memory reads the whole table to
 * throw most of it away. That argument is about ROWS, and at these sizes the cost is
 * STATEMENTS: a `prepare` + bind + step is a fixed charge that four of them pay four
 * times over. Measured over the same warm caches, alternating the order of the arms,
 * 300 calls each, two runs:
 *
 *   | selection            | 30 tasks       | 300 tasks      |
 *   |----------------------|---------------:|---------------:|
 *   | one statement/state  | 0.20–0.24 ms   | 0.23–0.24 ms   |
 *   | one scan + classify  | 0.07 ms        | 0.20 ms        |
 *
 * against a WHOLE `bootstrap` of 0.87 ms, so on a small record the difference is
 * about a sixth of the opening read. So {@link liveWork}, whose set is four of the machine's seven
 * states, takes ONE statement and classifies the rows — the index would select most
 * of the table anyway — while {@link tasksAwaitingJudgement}, whose set is one state
 * and a small slice of it, asks the index like its neighbours. The rule behind both
 * is the same sentence: ask the index when the answer is a small part of the table.
 *
 * Neither of them writes out a set of states either way; what differs is only whether
 * the derived set is a bucket to fetch or a membership to test.
 *
 * ACROSS THE TREES the caller can see, for the reason `bootstrap` gives: a task lands
 * in the tree that travels, whoever wrote it, so "the actor's tree" names no tree in
 * particular. Reading per-tree projections and concatenating is not an approximation
 * of reading the union — a task's whole history lands in ONE tree, so the per-tree
 * fold and the union fold see the same events for it.
 */

import {
  isTaskState,
  type ProjectionCache,
  TASK_STATES,
  type TaskProjection,
  type TaskState,
  taskDisposition,
} from '@mnema/core';
import { statesMeaning } from './disposition.js';

/**
 * The states whose tasks still have something to do about them — derived, never
 * restated, and held as a SET because this one is asked "is this state live" per row
 * rather than "give me the rows in this state" (see the module doc's measurement).
 */
const LIVE: ReadonlySet<string> = new Set(
  statesMeaning(TASK_STATES, taskDisposition, 'advancing', 'stalled'),
);

/** The states whose tasks are waiting on somebody's verdict — derived, never restated. */
const AWAITING_JUDGEMENT = statesMeaning(TASK_STATES, taskDisposition, 'awaiting-judgement');

/** One live piece of work, NAMED — a unit of "what can be done". */
export interface WorkItem {
  /** The task's id — the key {@link nextActionsForTask} takes. */
  readonly id: string;
  readonly title: string;
  /**
   * The task's current state, typed as the workflow's own vocabulary rather than a
   * bare string — which is what lets a surface print it on a line whose count has to
   * match the count of items served.
   *
   * A projection stores `state` as a literal string on purpose, so a fact written
   * today stays legible if the workflow later renames a state; a word the workflow has
   * never had therefore reaches the reads below, and the honest answer for it is that
   * it is on no list. Narrowed by the product's own validator ({@link isTaskState}) on
   * the read that scans, and by the bucket asked for on the read that is indexed.
   */
  readonly state: TaskState;
  /** `at` of its last transition — what "most recently touched" orders on. */
  readonly updatedAt: string;
}

/**
 * A task nobody has ruled on yet — a name, plus the state that says WHICH ruling is
 * missing.
 *
 * It carries the same fields a {@link WorkItem} does and adds the `kind`, because
 * this one lands on a list shared with two other machines: an index is only an index
 * if its reader knows where the rest of an item is, and one list holding three sorts
 * of item has to say which is which per line. A task's rest is the moves its position
 * allows — `nextActions`, asked per task — which for `IN_REVIEW` is the pair of
 * verdicts (`approve`, `request_changes`) and the proof each demands.
 */
export interface TaskAwaitingJudgement extends WorkItem {
  /**
   * Always `task`: the discriminant, and what says this line is a piece of WORK
   * awaiting a ruling rather than a call or a pattern awaiting one.
   */
  readonly kind: 'task';
}

/**
 * Every live task across `caches`, in no particular order.
 *
 * ORDERING IS THE CALLER'S, as it is for both neighbouring modules' waiting halves:
 * this answer is ordered by {@link bootstrap} together with the cut it feeds, and an
 * order imposed here would be one the composition immediately discards while a reader
 * of this function took it for the answer's.
 *
 * ONE statement per cache, classifying the rows — see the module doc for the number
 * that decided it against four indexed reads.
 */
export function liveWork(caches: readonly ProjectionCache[]): WorkItem[] {
  const live: WorkItem[] = [];
  for (const cache of caches) {
    for (const task of cache.listTasks()) {
      if (!isTaskState(task.state) || !LIVE.has(task.state)) continue;
      live.push(named(task, task.state));
    }
  }
  return live;
}

/**
 * Every task awaiting a judgement across `caches`, in no particular order.
 *
 * Half of ONE list — tasks, decisions and skills interleaved by when each last moved
 * (see {@link bootstrap}) — so the ordering is the composition's, exactly as it is
 * for {@link decisionsAwaitingJudgement} and {@link skillsAwaitingJudgement}.
 */
export function tasksAwaitingJudgement(
  caches: readonly ProjectionCache[],
): TaskAwaitingJudgement[] {
  const pending: TaskAwaitingJudgement[] = [];
  for (const cache of caches) {
    for (const state of AWAITING_JUDGEMENT) {
      for (const task of cache.listTasksByState(state)) {
        pending.push({ kind: 'task', ...named(task, state) });
      }
    }
  }
  return pending;
}

/**
 * The projection as a NAME: id, title, position and when it last moved, and nothing
 * else.
 *
 * The moves a position allows are the task's BODY — the whole row set out of its
 * state, each action with the proof it demands — and they are served by
 * {@link nextActions}, asked about the one task the caller decided to act on. Both
 * lists here are indexes, so both are named by this one function: a second shaping
 * would be a second answer to "what is a task called on a list".
 */
function named(task: TaskProjection, state: TaskState): WorkItem {
  return { id: task.id, title: task.title, state, updatedAt: task.updatedAt };
}
