/**
 * @mnema/core — the work domain.
 *
 * Built on @mnema/chain (the source of truth), it holds: the projections that
 * replay chain events into a queryable SQLite cache without re-validating them;
 * the workflow and its write-time gate; and identity — how an entity is named
 * for a human without that name ever becoming its identity.
 *
 * The projection cache is pure: it is derived from the chain, never committed,
 * and rebuilt by dropping and replaying — there are no data migrations.
 */

export const PACKAGE_NAME = '@mnema/core';

export { openDatabase, type SqliteDatabase } from './db/sqlite.js';
export {
  ALIAS_PREFIXES,
  type AliasKind,
  type AliasSubject,
  canonicalId,
  canonicalIdentity,
  deriveAlias,
  disambiguate,
  SHORT_ALIAS_HEX,
} from './identity/index.js';
export { type CacheOptions, ProjectionCache } from './projections/cache.js';
export {
  type AdrCollision,
  adrCollisions,
  type DecisionProjection,
  projectDecisions,
} from './projections/decision.js';
export {
  getDecision,
  listDecisions,
  listDecisionsByState,
} from './projections/decision-store.js';
export { type MemoryProjection, projectKnowledge } from './projections/knowledge.js';
export { getMemory, listMemories } from './projections/knowledge-store.js';
export { orderedEvents, orderedEventsAcross } from './projections/order.js';
export { projectRuns, type RunProjection } from './projections/run.js';
export { getRun, listOpenRuns, listRuns } from './projections/run-store.js';
export { projectTasks, type TaskProjection } from './projections/task.js';
export { getTask, listTasks, listTasksByState } from './projections/task-store.js';
export {
  chainRootForScope,
  type DiscoveryEnv,
  type Origin,
  type ResolvedTrees,
  resolveScope,
  resolveTrees,
  type Scope,
  TreeUnavailableError,
} from './topology/index.js';
export {
  type Clock,
  DECISION_ACTIONS,
  DECISION_STATES,
  DECISION_TRANSITIONS,
  type DecisionAction,
  type DecisionGateErr,
  type DecisionGateErrorCode,
  type DecisionGateOk,
  type DecisionGateRequest,
  type DecisionGateResult,
  type DecisionProofField,
  type DecisionState,
  type DecisionTransition,
  decisionGate,
  findDecisionTransition,
  findTransition,
  type GateErr,
  type GateErrorCode,
  type GateOk,
  type GateRequest,
  type GateResult,
  gate,
  INITIAL_DECISION_STATE,
  INITIAL_STATE,
  isDecisionState,
  isTaskState,
  type ProofField,
  systemClock,
  TASK_ACTIONS,
  TASK_STATES,
  type TaskAction,
  type TaskState,
  TRANSITIONS,
  type Transition,
} from './workflow/index.js';
