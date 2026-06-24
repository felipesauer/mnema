/**
 * The kind of evidence backing an acceptance criterion. Mirrors the
 * `kind IN (...)` CHECK constraint on the `task_evidence` table.
 */
export const EVIDENCE_KINDS = ['test', 'route', 'commit', 'doc', 'url', 'other'] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Narrows an arbitrary string to a valid {@link EvidenceKind}. */
export function isEvidenceKind(value: string): value is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(value);
}

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
