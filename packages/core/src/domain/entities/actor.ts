import type { ActorKind } from '../enums/actor-kind.js';

/**
 * Actor entity — humans and agents are unified in a single table.
 */
export interface Actor {
  readonly id: string;
  /** Unique handle, e.g. `"daniel"` or `"agent:planner"` */
  readonly handle: string;
  readonly kind: ActorKind;
  readonly display: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}
