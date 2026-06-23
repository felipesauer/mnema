/**
 * The kind of evidence backing an acceptance criterion.
 */
export type EvidenceKind = 'test' | 'route' | 'commit' | 'doc' | 'url' | 'other';

/**
 * Evidence linking a task's acceptance criterion (by its 0-based index
 * into the task's `acceptanceCriteria` array) to something concrete: a
 * test path, a route, a commit, a doc, a url. Additive and opt-in — a
 * task with no evidence behaves exactly as a task did before this table
 * existed.
 */
export interface TaskEvidence {
  readonly id: string;
  readonly taskId: string;
  /** 0-based index into the task's acceptanceCriteria array. */
  readonly criterionIndex: number;
  readonly kind: EvidenceKind;
  /** The concrete reference — a path, route, sha, or url. */
  readonly ref: string;
  readonly note: string | null;
  readonly createdAt: string;
}
