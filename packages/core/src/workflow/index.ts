/**
 * The task workflow: the product's fixed opinion about how work moves, plus the
 * gate that authorizes each move at write time.
 */

export {
  type GateErr,
  type GateErrorCode,
  type GateOk,
  type GateRequest,
  type GateResult,
  gate,
} from './gate.js';
export { INITIAL_STATE, isTaskState, TASK_STATES, type TaskState } from './states.js';
export {
  findTransition,
  type ProofField,
  TASK_ACTIONS,
  type TaskAction,
  TRANSITIONS,
  type Transition,
} from './transitions.js';
