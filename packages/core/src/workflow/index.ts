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
  enrollKey,
  ensureFounded,
  foundIdentity,
  type IdentityOk,
  revokeKey,
} from './identity-operations.js';
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
export {
  type EndRunError,
  type EndRunInput,
  type EndRunOk,
  endRun,
  type StartRunError,
  type StartRunInput,
  type StartRunOk,
  startRun,
} from './session-operations.js';
export {
  type SkillGateErr,
  type SkillGateErrorCode,
  type SkillGateOk,
  type SkillGateRequest,
  type SkillGateResult,
  skillGate,
} from './skill-gate.js';
export {
  adoptSkill,
  createSkill,
  deprecateSkill,
  rejectSkill,
  reviewSkill,
  type SkillCreateInput,
  type SkillCreateOk,
  type SkillTransitionInput,
  type SkillTransitionOk,
  type SkillWriteContext,
  type SkillWriteError,
} from './skill-operations.js';
export {
  INITIAL_SKILL_STATE,
  isSkillState,
  SKILL_STATES,
  type SkillState,
} from './skill-states.js';
export {
  findSkillTransition,
  SKILL_ACTIONS,
  SKILL_TRANSITIONS,
  type SkillAction,
  type SkillProofField,
  type SkillTransition,
} from './skill-transitions.js';
export { INITIAL_STATE, isTaskState, TASK_STATES, type TaskState } from './states.js';
export {
  findTransition,
  type ProofField,
  TASK_ACTIONS,
  type TaskAction,
  TRANSITIONS,
  type Transition,
} from './transitions.js';
