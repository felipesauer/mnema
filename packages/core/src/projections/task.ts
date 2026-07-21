/**
 * The task projection: fold an ordered event stream into current task state.
 *
 * This is a PURE, deterministic replay. It does not validate — the workflow
 * gate already ran at write time and its verdict is baked into the facts; a
 * projection replays facts, it never re-judges them. Given the same ordered
 * events it always produces the same result, so it can be run in memory, or to
 * rebuild the cache, or incrementally, and always agree.
 *
 * The single rule, applied verbatim:
 *   - a task EXISTS once its `task.created` is seen;
 *   - its STATE is the `to` of its last `task.transitioned` (birth included);
 *   - its TITLE is from `task.created`.
 *
 * A subject with transitions but no `task.created` does not exist and is not
 * projected — state without existence is not a task. Because state is read from
 * the literal `to`, never derived from a workflow, replaying old facts yields
 * the state that happened, not one re-derived from today's rules.
 */

import type { CatalogEvent } from '@mnema/chain';

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
}

/** Mutable accumulator; existence and state are tracked separately, then joined. */
interface TaskAccumulator {
  title?: string;
  createdAt?: string;
  state?: string;
  updatedAt?: string;
}

/**
 * Folds ordered events into a map of task id → projection. A task is projected
 * only when it has BOTH a `task.created` (existence) and at least one
 * transition (state). Birth emits the two together, so an intact chain always
 * has both; the guard matters only for a truncated tail (a created event whose
 * birth transition was not yet written), which is dropped rather than
 * materialized with an invented empty state.
 */
export function projectTasks(events: readonly CatalogEvent[]): Map<string, TaskProjection> {
  const acc = new Map<string, TaskAccumulator>();

  for (const event of events) {
    if (event.kind === 'task.created') {
      const entry = getOrInit(acc, event.subject);
      entry.title = event.payload.title;
      entry.createdAt = event.at;
    } else if (event.kind === 'task.transitioned') {
      const entry = getOrInit(acc, event.subject);
      entry.state = event.payload.to;
      entry.updatedAt = event.at;
    }
  }

  const result = new Map<string, TaskProjection>();
  for (const [id, entry] of acc) {
    // Existence needs the created event; state needs a transition. A subject
    // missing either is not a complete task and is not projected — never given
    // a fabricated state.
    if (
      entry.title === undefined ||
      entry.createdAt === undefined ||
      entry.state === undefined ||
      entry.updatedAt === undefined
    ) {
      continue;
    }
    result.set(id, {
      id,
      title: entry.title,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }
  return result;
}

function getOrInit(acc: Map<string, TaskAccumulator>, id: string): TaskAccumulator {
  let entry = acc.get(id);
  if (entry === undefined) {
    entry = {};
    acc.set(id, entry);
  }
  return entry;
}
