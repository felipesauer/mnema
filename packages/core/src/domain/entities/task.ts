import type { TaskState } from '../enums/task-state.js';

/**
 * Task entity. Immutable — updates produce a new instance.
 *
 * Field names use camelCase in TypeScript; repositories translate to and
 * from snake_case at the SQL boundary.
 */
export interface Task {
  /** Internal UUID v7 */
  readonly id: string;
  /** Human-friendly identifier, e.g. `"WEBAPP-42"` */
  readonly key: string;
  readonly projectId: string;
  readonly epicId: string | null;
  readonly sprintId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly state: TaskState;
  readonly estimate: number | null;
  /** Estimated context cost in tokens; null when unsized. Distinct from `estimate` (story points). */
  readonly contextBudget: number | null;
  readonly priority: number;
  readonly assigneeId: string | null;
  readonly reporterId: string;
  readonly reopenCount: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** ISO8601 timestamp */
  readonly createdAt: string;
  /** ISO8601 timestamp; used for optimistic versioning */
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly deletedAt: string | null;
  /** Actor id holding the current claim lease, or null when unclaimed. */
  readonly claimedBy: string | null;
  /** ISO8601 timestamp the claim lease expires at; null when unclaimed. */
  readonly leaseExpiresAt: string | null;
  /**
   * Git link (MNEMA-ADR-49), populated only by the opt-in `mnema watch
   * --git` observer. `gitBranch` is the branch this task's work lives on;
   * `gitCommits` the commits linked to it; `gitPr` its pull request. All
   * empty/null until the observer runs, and never written by the hot path.
   */
  readonly gitBranch: string | null;
  readonly gitCommits: readonly GitCommitRef[];
  readonly gitPr: GitPrRef | null;
}

/** A commit linked to a task — see {@link Task.gitCommits}. */
export interface GitCommitRef {
  readonly sha: string;
  readonly subject: string;
}

/** A task's pull request — see {@link Task.gitPr}. */
export interface GitPrRef {
  readonly url: string;
  readonly state: string;
}
