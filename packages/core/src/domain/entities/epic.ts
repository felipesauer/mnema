import type { EpicState } from '../enums/epic-state.js';

/**
 * Epic entity — aggregates tasks under a theme or feature.
 */
export interface Epic {
  /** The committed identity (UUID v7); a short alias is derived for display. */
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: EpicState;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly deletedAt: string | null;
}
