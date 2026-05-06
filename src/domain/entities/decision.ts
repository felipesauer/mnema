import type { DecisionStatus } from '../enums/decision-status.js';

/**
 * Decision entity — Architecture Decision Record (ADR).
 */
export interface Decision {
  readonly id: string;
  /** Human-friendly key, e.g. `"ADR-0042"` */
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly context: string | null;
  readonly decision: string;
  readonly rationale: string | null;
  readonly consequences: string | null;
  readonly status: DecisionStatus;
  readonly supersededBy: string | null;
  readonly authoredBy: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly at: string;
  readonly deletedAt: string | null;
}
