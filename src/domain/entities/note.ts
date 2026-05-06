/**
 * Allowed kinds of Note attached to a task.
 */
export type NoteKind =
  | 'comment'
  | 'block_reason'
  | 'unblock_reason'
  | 'review_feedback'
  | 'review_approval'
  | 'cancel_reason'
  | 'reopen_reason'
  | 'agent_observation';

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
