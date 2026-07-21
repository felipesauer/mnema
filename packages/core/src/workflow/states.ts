/**
 * The task workflow's states, fixed in typed code.
 *
 * The workflow is not data loaded from a project file; it is the product's one
 * opinion about how work moves, expressed as literal string types the compiler
 * checks. States are stored on events as those literal strings, never pointers
 * into this table — so a fact written today stays legible even if the workflow
 * later grows or drops a state. This module only NAMES the states; the legal
 * moves between them live in the transition table.
 */

/** The seven states a task can be in. */
export const TASK_STATES = [
  'DRAFT',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'DONE',
  'CANCELED',
] as const;

/** A task's state — one of the seven, as a literal string. */
export type TaskState = (typeof TASK_STATES)[number];

/** The state every task is born into. */
export const INITIAL_STATE: TaskState = 'DRAFT';

/** True when `value` is one of the workflow's states. */
export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}
