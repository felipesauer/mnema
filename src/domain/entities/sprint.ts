import type { SprintState } from '../enums/sprint-state.js';

/**
 * Sprint entity — a planned cycle of work.
 */
export interface Sprint {
  readonly id: string;
  /** Human-friendly key, e.g. `"WEBAPP-SPRINT-12"` */
  readonly key: string;
  readonly projectId: string;
  readonly name: string;
  readonly goal: string | null;
  readonly state: SprintState;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly capacity: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly deletedAt: string | null;
}
