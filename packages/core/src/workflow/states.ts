/**
 * The task workflow's states, fixed in typed code.
 *
 * The workflow is not data loaded from a project file; it is the product's one
 * opinion about how work moves, expressed as literal string types the compiler
 * checks. The states are part of the format (`WORKFLOWS` in `@mnema/chain`,
 * FORMAT.md §6.7), because every reader judges a move by them; this module takes
 * them from there and only NAMES them for the domain. The legal moves between
 * them live in the transition table.
 */

import { WORKFLOWS } from '@mnema/chain';

/** The seven states a task can be in. */
export const TASK_STATES = WORKFLOWS['task.transitioned'].states;

/** A task's state: one of the seven, as a literal string. */
export type TaskState = (typeof TASK_STATES)[number];

/** The state every task is born into. */
export const INITIAL_STATE: TaskState = WORKFLOWS['task.transitioned'].birth.to;

/** True when `value` is one of the workflow's states. */
export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}
