/**
 * The workflows: the product's fixed opinions about how work moves — one for
 * tasks, one for decisions — plus the gates that authorize each move at write
 * time and the operations that append only what a gate authorized.
 */

export { type Clock, systemClock } from './clock.js';
export {
  type DecisionGateErr,
  type DecisionGateErrorCode,
  type DecisionGateOk,
  type DecisionGateRequest,
  type DecisionGateResult,
  decisionGate,
} from './decision-gate.js';
export {
  acceptDecision,
  type DecisionTransitionInput,
  type DecisionTransitionOk,
  type DecisionWriteContext,
  type DecisionWriteError,
  type RecordInput,
  type RecordOk,
  recordDecision,
  rejectDecision,
  type SupersedeInput,
  supersedeDecision,
} from './decision-operations.js';
export {
  DECISION_STATES,
  type DecisionState,
  INITIAL_DECISION_STATE,
  isDecisionState,
} from './decision-states.js';
export {
  DECISION_ACTIONS,
  DECISION_TRANSITIONS,
  type DecisionAction,
  type DecisionProofField,
  type DecisionTransition,
  findDecisionTransition,
} from './decision-transitions.js';
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
