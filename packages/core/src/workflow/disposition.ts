/**
 * What a task's STATE means to whoever is reading it — the position's disposition.
 *
 * A state answers "where is this task"; a disposition answers what the reader does
 * about it. The two are not the same question, and a task's seven states are not seven
 * unrelated labels: they are POSITIONS IN A CYCLE, and the transition table gives each
 * position a structurally different set of exits. That structure is the whole of what
 * this module classifies, so every row below is a property of `TRANSITIONS` and
 * not a taste.
 *
 * READ AGAINST THE TABLE OF MOVES, state by state — this is the derivation, and
 * `disposition.test.ts` recomputes it from the table rather than trusting the prose:
 *   - `DRAFT`, `READY`, `IN_PROGRESS` — several exits, and at least one of them asks
 *     for no proof at all: `submit`, `start`, `submit_review`. There is a way FORWARD
 *     that costs nothing but the move. That is `advancing`.
 *   - `BLOCKED` — ONE exit, `unblock`, and it requires nothing. The single way out
 *     leads back to `IN_PROGRESS`, the state that reached here, so nothing can be
 *     progressed from this position: the only move undoes the position itself, and it
 *     is free because a block was never an achievement. That is `stalled`.
 *   - `IN_REVIEW` — two exits, `approve` and `request_changes`, and BOTH require a
 *     proof field (`note`, `feedback`). Every way out of this position is a verdict
 *     somebody owes. That is `awaiting-judgement`.
 *   - `DONE` — ONE exit, `reopen`, and it requires a `reason`. Like `BLOCKED` the only
 *     move undoes the position, and unlike `BLOCKED` undoing it COSTS AN EXPLANATION,
 *     which is the whole difference between a task that cannot move and a task that
 *     has arrived. That is `settled`.
 *   - `CANCELED` — no row leaves it. Nothing is pending and nothing can be done. That
 *     is `closed`.
 *
 * WHY A TABLE AND NOT THAT DERIVATION AS CODE. The five paragraphs above ARE an
 * algorithm over the transition table, and running it at read time would classify an
 * eighth state silently, by whatever its exits happened to look like. A
 * `Record<TaskState, TaskDisposition>` is TOTAL in the compiler instead: a state added
 * to the machine does not build until somebody has said what it means to a reader, and
 * the test is what keeps the said thing honest against the table it claims to read.
 *
 * IT IS A CLASSIFICATION AND NOT A SECOND VOCABULARY OF POSITIONS. The five names say
 * what a reader does — nothing here is a state, nothing here is storable, and no event
 * ever carries one. The decision and skill machines have their own classification, in
 * their own words, in the module that owns their reads (`copilot`): they answer "does
 * this govern", which a task does not have, while a task answers "can this move", which
 * they do not. One vocabulary over three machines would have to be the union of both
 * questions, and every reader of it would then meet values that cannot occur.
 *
 * {@link TASK_DISPOSITION} is exported so the claims above are CHECKABLE against the
 * table they are read from, rather than asserted in prose. It is not on the package's
 * public surface — a consumer gets {@link taskDisposition}, the question, never the
 * classification behind it — and that it stays off it is checked rather than declared:
 * `no-classification-table-reaches-the-surface.test.ts` walks every entry point's
 * runtime exports.
 */

import type { TaskState } from './states.js';

/**
 * What one position in the task cycle means to a reader of the record.
 *
 * Five, and each one is a different thing to do about the task. They are deliberately
 * NOT ordered: a disposition is not a rank, and nothing reads one by index.
 */
export type TaskDisposition =
  /** There is a way forward that costs nothing but the move. */
  | 'advancing'
  /** Nothing can be progressed: the only move undoes the position. */
  | 'stalled'
  /** Every way out is a verdict somebody owes. */
  | 'awaiting-judgement'
  /** It arrived, and undoing that costs an explanation. */
  | 'settled'
  /** No move leaves it: nothing is pending and nothing can be done. */
  | 'closed';

/**
 * What each of the seven states means to a reader — TOTAL, so an eighth state cannot
 * be added to the machine without being classified here.
 *
 * Every row is derived from `TRANSITIONS`; the module doc reads the table state
 * by state, and `disposition.test.ts` recomputes the whole classification from the
 * table's own rows and asserts it equals this.
 */
export const TASK_DISPOSITION: Readonly<Record<TaskState, TaskDisposition>> = {
  DRAFT: 'advancing',
  READY: 'advancing',
  IN_PROGRESS: 'advancing',
  BLOCKED: 'stalled',
  IN_REVIEW: 'awaiting-judgement',
  DONE: 'settled',
  CANCELED: 'closed',
};

/**
 * What a state means to a reader — the table asked, never a second opinion.
 *
 * This is the whole of what crosses the package boundary: a surface asks what a
 * position means and is answered, so the classification is written once. A consumer
 * that could read the table would be a consumer able to re-derive the meaning where
 * nobody can see the two copies drift.
 */
export function taskDisposition(state: TaskState): TaskDisposition {
  return TASK_DISPOSITION[state];
}
