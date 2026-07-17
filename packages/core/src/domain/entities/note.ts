/**
 * Allowed kinds of Note attached to a task.
 *
 * `scope_change` and `acceptance_addendum` carry stronger intent than
 * `agent_observation` for the audit reader — use them when an agent
 * logs a scope deviation or a new acceptance criterion mid-flight.
 * `agent_observation` stays as the catch-all for anything that does
 * not fit a specific kind.
 */
export type NoteKind =
  | 'comment'
  | 'block_reason'
  | 'unblock_reason'
  | 'review_feedback'
  | 'review_approval'
  | 'cancel_reason'
  | 'reopen_reason'
  | 'agent_observation'
  | 'scope_change'
  | 'acceptance_addendum';

/**
 * Note entity — a typed annotation attached to a task.
 */
export interface Note {
  readonly id: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly kind: NoteKind;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly at: string;
  readonly deletedAt: string | null;
}
