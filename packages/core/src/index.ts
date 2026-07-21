/**
 * @mnema/core — the work domain.
 *
 * Projections (event → state materialized in SQLite) live here, built on
 * @mnema/chain: the chain is the source of truth, and the projections replay
 * its events into a queryable cache without re-validating them. Workflow gates
 * and identity land in following changes.
 *
 * The projection cache is pure: it is derived from the chain, never committed,
 * and rebuilt by dropping and replaying — there are no data migrations.
 */

export const PACKAGE_NAME = '@mnema/core';

export { openDatabase, type SqliteDatabase } from './db/sqlite.js';
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
  TASK_ACTIONS,
  TASK_STATES,
  type TaskAction,
  type TaskState,
  TRANSITIONS,
  type Transition,
} from './workflow/index.js';
