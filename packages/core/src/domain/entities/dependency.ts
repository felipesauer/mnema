/**
 * Allowed kinds of relationship between two tasks. `blocks` is a hard edge
 * that gates readiness; `relates_to` is a soft, informational link.
 */
export type DependencyKind = 'blocks' | 'relates_to';

/**
 * Dependency entity — a directed relationship between two tasks.
 */
export interface Dependency {
  readonly id: string;
  readonly taskId: string;
  readonly blocksTaskId: string;
  readonly kind: DependencyKind;
  readonly createdAt: string;
}
