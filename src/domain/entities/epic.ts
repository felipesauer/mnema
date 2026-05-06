import type { EpicState } from '../enums/epic-state.js';

/**
 * Epic entity — aggregates tasks under a theme or feature.
 */
export interface Epic {
  readonly id: string;
  /** Human-friendly key, e.g. `"WEBAPP-EPIC-3"` */
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: EpicState;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly deletedAt: string | null;
}
