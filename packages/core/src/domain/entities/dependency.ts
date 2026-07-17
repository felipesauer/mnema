/**
 * Allowed kinds of relationship between two tasks.
 */
export type DependencyKind = 'blocks' | 'relates_to' | 'duplicates' | 'parent_of';

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
