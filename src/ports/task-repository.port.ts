import type { GitCommitRef, GitPrRef, Task } from '../domain/entities/task.js';

/**
 * Persistence PORT for {@link Task}.
 *
 * This is the interface services depend on, so a service can be unit-tested
 * (or re-hosted) against any implementation — an in-memory fake, a different
 * store — without a real SQLite file on disk. The SQLite implementation
 * (`TaskRepository`) is one adapter behind this port.
 *
 * The data-shape types the port needs live HERE (not in the SQLite adapter)
 * so the port is self-contained: it never imports from `storage/`. That is
 * the point of the seam — the dependency arrow points at the port, not at a
 * concrete substrate.
 *
 * Scope note: this is the first port extracted as the pattern; other
 * repositories can follow the same shape. It is NOT about swapping the
 * database or shipping a package — it is internal testability and reuse.
 */
export interface ITaskRepository {
  findByKey(key: string): Task | null;
  findById(id: string): Task | null;
  findByKeyIncludingDeleted(key: string): Task | null;
  findByState(state: string): Task[];
  findByEpic(epicId: string): Task[];
  findAllActive(): Task[];
  findActiveLean(filter?: LeanTaskFilter): LeanTask[];
  findByTitle(projectId: string, title: string): Task[];
  nextSequence(projectId: string): number;
  countActive(): number;
  insert(input: TaskInsertInput): Task;
  updateState(
    taskId: string,
    newState: string,
    expectedUpdatedAt?: string | null,
    closedAt?: ClosedAtChange,
  ): UpdateStateResult;
  updateFields(taskId: string, fields: TaskFieldUpdates): Task;
  incrementReopenCount(taskId: string): Task | null;
  setGitLink(
    taskId: string,
    link: { branch: string | null; commits: readonly GitCommitRef[]; pr: GitPrRef | null },
  ): Task | null;
  claim(taskId: string, actorId: string, leaseExpiresAt: string, now: string): ClaimResult;
  findClaim(taskId: string): { claimedBy: string | null; leaseExpiresAt: string | null } | null;
  clearClaim(taskId: string): boolean;
  releaseClaim(taskId: string, actorId: string): boolean;
  softDelete(taskId: string): boolean;
  restore(taskId: string): boolean;
  runInTransaction<T>(fn: () => T): T;
  runInTransactionImmediate<T>(fn: () => T): T;
}

/** Lean projection returned by {@link ITaskRepository.findActiveLean}. */
export interface LeanTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly priority: number;
  readonly assigneeId: string | null;
  readonly epicId: string | null;
  readonly sprintId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly claimedBy: string | null;
  readonly leaseExpiresAt: string | null;
}

/**
 * Optional equality filters pushed into SQL by {@link ITaskRepository.findActiveLean}.
 * Values must be non-null — this method matches by equality and does not
 * support `IS NULL` filtering (a null here would match no rows and bypass
 * the partial indexes).
 */
export interface LeanTaskFilter {
  readonly state?: string;
  readonly epicId?: string;
  readonly sprintId?: string;
}

/** Input shape for {@link ITaskRepository.insert}. */
export interface TaskInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly reporterId: string;
  readonly description?: string | null;
  readonly acceptanceCriteria?: readonly string[];
  readonly state?: string;
  readonly estimate?: number | null;
  readonly contextBudget?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly epicId?: string | null;
  readonly sprintId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Preserved on a clone rebuild; defaults to 0 for a genuinely new task. */
  readonly reopenCount?: number;
  /** Committed timestamps, preserved on a clone rebuild; default to now/null. */
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly closedAt?: string | null;
}

/**
 * Fields {@link ITaskRepository.updateFields} is allowed to overwrite.
 *
 * Whitelist by design: only attributes that map to first-class columns
 * on the `tasks` table appear here. Annotation-only payload bits
 * (`reason`, `approval_note`, `pr_url`, …) stay in `transitions.payload`
 * and never touch the task record.
 */
export interface TaskFieldUpdates {
  readonly title?: string;
  readonly description?: string | null;
  readonly acceptanceCriteria?: readonly string[];
  readonly estimate?: number | null;
  readonly contextBudget?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * The close timestamp, reconciled from the authoritative markdown on a
   * sync rebuild. Distinct from the {@link ClosedAtChange} boundary logic in
   * `updateState` (which stamps `now` / clears): here the exact committed
   * value is written back, because on rebuild the mirror is the source of
   * truth. `null` clears it (a task reopened on disk).
   */
  readonly closedAt?: string | null;
}

/**
 * What a state change does to `closed_at`. The repository is workflow-agnostic
 * — the caller (which knows the workflow's terminal set) decides: `stamp` when
 * entering a terminal state, `clear` when leaving one (a reopen), `leave`
 * otherwise. Defaults to `leave` so existing callers keep their behaviour.
 */
export type ClosedAtChange = 'stamp' | 'clear' | 'leave';

/** Reason an `updateState` call failed. */
export type UpdateStateFailure =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'CONFLICT'; readonly currentUpdatedAt: string };

/** Outcome of a state update attempt. */
export type UpdateStateResult =
  | { readonly ok: true; readonly task: Task }
  | { readonly ok: false; readonly reason: UpdateStateFailure };

/** Reason a `claim` call failed. */
export type ClaimFailure =
  | { readonly kind: 'NOT_FOUND' }
  | {
      readonly kind: 'ALREADY_CLAIMED';
      readonly claimedBy: string;
      readonly leaseExpiresAt: string;
    };

/** Outcome of a claim attempt. */
export type ClaimResult =
  | { readonly ok: true; readonly task: Task }
  | { readonly ok: false; readonly reason: ClaimFailure };
