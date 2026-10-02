/**
 * next_action: from a task's current state, the moves the workflow allows next.
 *
 * This is the purest derivation in the layer — it reads only the workflow's own
 * transition table and returns the rows that leave the given state. It invents
 * nothing: each suggestion is a real `Transition` the gate would authorize, so
 * "what can I do next" always agrees with "what the gate will accept". A
 * terminal state (one no transition leaves) yields an empty list — there is no
 * phantom action to offer.
 *
 * It is deliberately stateless: it takes a state string, not a chain, because
 * the answer is a property of the workflow, not of any one task's history. The
 * cache-bound convenience `nextActionsForTask` looks a task up and applies it.
 */

import {
  isTaskState,
  type ProjectionCache,
  type ProofField,
  type TaskAction,
  type TaskState,
  TRANSITIONS,
} from '@mnema/core';

/** One move available from a state: the action, where it leads, what it needs. */
export interface NextAction {
  /** The action to request. */
  readonly action: TaskAction;
  /** The state this action reaches, as the workflow defines it. */
  readonly to: TaskState;
  /** The proof fields this action requires; empty when it needs none. */
  readonly requires: readonly ProofField[];
}

/**
 * The moves available from `state`, read straight from the workflow's transition
 * table. Returns an empty list for a terminal state, and also for a string that
 * is not a workflow state at all — an unknown state has no legal move, which is
 * the honest answer rather than a thrown error (a surface may forward junk).
 */
export function nextActions(state: string): NextAction[] {
  if (!isTaskState(state)) return [];
  const out: NextAction[] = [];
  for (const t of TRANSITIONS) {
    if (t.from === state) out.push({ action: t.action, to: t.to, requires: t.requires });
  }
  return out;
}

/**
 * The moves available for a specific task, looked up in the cache. Returns null
 * when the task is not projected (it does not exist, or its tail is truncated) —
 * distinct from an existing task in a terminal state, which returns an empty
 * list. The lookup is the only read; the derivation itself stays pure.
 */
export function nextActionsForTask(cache: ProjectionCache, id: string): NextAction[] | null {
  const task = cache.getTask(id);
  if (task === null) return null;
  return nextActions(task.state);
}
