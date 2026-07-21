/**
 * The task workflow: the product's fixed opinion about how work moves, plus the
 * gate that authorizes each move at write time.
 */

export { type Clock, systemClock } from './clock.js';
export {
  type GateErr,
  type GateErrorCode,
  type GateOk,
  type GateRequest,
  type GateResult,
  gate,
} from './gate.js';
export {
  type CreateInput,
  type CreateOk,
  createTask,
  type TransitionInput,
  type TransitionOk,
  transitionTask,
  type WriteContext,
  type WriteError,
} from './operations.js';
export { INITIAL_STATE, isTaskState, TASK_STATES, type TaskState } from './states.js';
export {
  findTransition,
  type ProofField,
  TASK_ACTIONS,
  type TaskAction,
  TRANSITIONS,
  type Transition,
} from './transitions.js';
