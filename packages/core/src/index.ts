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
  canonicalIdentity,
  deriveAlias,
  disambiguate,
  SHORT_ALIAS_HEX,
} from './identity/index.js';
export { type CacheOptions, ProjectionCache } from './projections/cache.js';
export { orderedEvents } from './projections/order.js';
export { rebuild } from './projections/rebuild.js';
export { projectRuns, type RunProjection } from './projections/run.js';
export {
  getRun,
  listOpenRuns,
  listRuns,
  materializeRuns,
} from './projections/run-store.js';
export { projectTasks, type TaskProjection } from './projections/task.js';
export {
  getTask,
  listTasks,
  listTasksByState,
  materializeTasks,
} from './projections/task-store.js';
export {
  type Clock,
  type CreateInput,
  type CreateOk,
  createTask,
  findTransition,
  type GateErr,
  type GateErrorCode,
  type GateOk,
  type GateRequest,
  type GateResult,
  gate,
  INITIAL_STATE,
  isTaskState,
  type ProofField,
  systemClock,
  TASK_ACTIONS,
  TASK_STATES,
  type TaskAction,
  type TaskState,
  TRANSITIONS,
  type Transition,
  type TransitionInput,
  type TransitionOk,
  transitionTask,
  type WriteContext,
  type WriteError,
} from './workflow/index.js';
