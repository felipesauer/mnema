/**
 * The task projection: fold an ordered event stream into current task state.
 *
 * This is a PURE, deterministic replay. It does not validate: the workflow
 * gate ran at write time, and every reader leaves out of the stream it hands a
 * fold any move the workflow does not allow (`order.ts`, FORMAT.md §6.7); a
 * projection replays what is left. Given the same ordered
 * events it always produces the same result, so it can be run in memory, or to
 * rebuild the cache, or incrementally, and always agree.
 *
 * The single rule, applied verbatim:
 *   - a task EXISTS once its `task.created` is seen;
 *   - its STATE is the `to` of its last `task.transitioned` (birth included);
 *   - its TITLE is from `task.created`.
 *
 * A subject with transitions but no `task.created` does not exist and is not
 * projected: state without existence is not a task. State is read from the
 * literal `to` of the moves the workflow allows; the workflow is part of the
 * format (FORMAT.md §6.7), so a fact written long ago is judged by the tables a
 * record of its version is judged by, not by rules a product changed on its own.
 */

import type { CatalogEvent } from '@mnema/chain';
import { type AccumulatorFold, accumulate, jsonEncoding } from './accumulate.js';
import { proofOf, type TransitionProof } from './proof.js';

/** Current projected state of one task. */
export interface TaskProjection {
  /** The task's id (the event subject). */
  readonly id: string;
  readonly title: string;
  /** The `to` of the last transition. */
  readonly state: string;
  /** `at` of the birth (task.created). */
  readonly createdAt: string;
  /** `at` of the last transition. */
  readonly updatedAt: string;
  /**
   * What each move of this task SAID, in the chain's own order: absent when no
   * transition ever carried proof. See `projections/proof.ts` for why it is every
   * move and not the last one.
   */
  readonly proof?: readonly TransitionProof[];
}

/** Mutable accumulator; existence and state are tracked separately, then joined. */
export interface TaskAccumulator {
  title?: string;
  createdAt?: string;
  state?: string;
  updatedAt?: string;
  proof?: TransitionProof[];
}

/**
 * The task fold: how an event moves a task's accumulator, and when one is a task. A task
 * is projected only when it has BOTH a `task.created` (existence) and at least one
 * transition (state). Birth emits the two together, so an intact chain always
 * has both; the guard matters only for a truncated tail (a created event whose
 * birth transition was not yet written), which is dropped rather than
 * materialized with an invented empty state.
 */
export const taskFold: AccumulatorFold<TaskAccumulator, TaskProjection> = {
  name: 'tasks',
  create: () => ({}),
  step(of, event) {
    if (event.kind === 'task.created') {
      const entry = of(event.subject);
      entry.title = event.payload.title;
      entry.createdAt = event.at;
    } else if (event.kind === 'task.transitioned') {
      const entry = of(event.subject);
      entry.state = event.payload.to;
      entry.updatedAt = event.at;
      const said = proofOf(event);
      if (said !== undefined) {
        entry.proof ??= [];
        entry.proof.push(said);
      }
    }
  },
  finish(id, entry) {
    // Existence needs the created event; state needs a transition. A subject
    // missing either is not a complete task and is not projected, never given
    // a fabricated state.
    if (
      entry.title === undefined ||
      entry.createdAt === undefined ||
      entry.state === undefined ||
      entry.updatedAt === undefined
    ) {
      return undefined;
    }
    return {
      id,
      title: entry.title,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.proof !== undefined ? { proof: entry.proof } : {}),
    };
  },
  ...jsonEncoding<TaskAccumulator>(),
};

/** Folds ordered events into a map of task id → projection ({@link taskFold}, over the whole stream). */
export function projectTasks(events: readonly CatalogEvent[]): Map<string, TaskProjection> {
  return accumulate(taskFold, events).projections;
}
