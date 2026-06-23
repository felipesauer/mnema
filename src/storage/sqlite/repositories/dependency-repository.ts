import type { Dependency, DependencyKind } from '../../../domain/entities/dependency.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface DependencyRow {
  readonly id: string;
  readonly task_id: string;
  readonly blocks_task_id: string;
  readonly kind: string;
  readonly created_at: string;
}

/**
 * Input for {@link DependencyRepository.insert}.
 */
export interface DependencyInsertInput {
  readonly taskId: string;
  readonly blocksTaskId: string;
  readonly kind: DependencyKind;
}

/**
 * Persistence for {@link Dependency}.
 *
 * Reuses the `dependencies` table shipped in migration 001 (PK, FKs to
 * `tasks`, `CHECK (task_id != blocks_task_id)`, `UNIQUE (task_id,
 * blocks_task_id, kind)` and indexes on both columns). A row
 * `(task_id=A, blocks_task_id=B)` reads as "A is blocked by B".
 *
 * `created_at` is written with {@link isoNow} rather than relying on the
 * SQL `datetime('now')` default — migration 005 had to rewrite the
 * default's space-separated stamps to ISO8601, so new rows are ISO8601
 * from the start.
 */
export class DependencyRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns a dependency by internal id.
   *
   * @param id - Dependency id
   * @returns The dependency or `null`
   */
  findById(id: string): Dependency | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM dependencies WHERE id = ?')
      .get(id) as DependencyRow | undefined;
    return row === undefined ? null : rowToDependency(row);
  }

  /**
   * Outgoing edges of a task — the dependencies it declares (what this
   * task depends on / is blocked by).
   *
   * @param taskId - Internal task id
   * @returns Dependencies ordered by creation time
   */
  findByTask(taskId: string): Dependency[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM dependencies WHERE task_id = ? ORDER BY created_at')
      .all(taskId) as DependencyRow[];
    return rows.map(rowToDependency);
  }

  /**
   * Incoming edges of a task — the dependencies that point at it (what
   * this task blocks).
   *
   * @param taskId - Internal task id
   * @returns Dependencies ordered by creation time
   */
  findBlocking(taskId: string): Dependency[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM dependencies WHERE blocks_task_id = ? ORDER BY created_at')
      .all(taskId) as DependencyRow[];
    return rows.map(rowToDependency);
  }

  /**
   * Checks whether a specific edge already exists.
   *
   * @param taskId - Dependent task id
   * @param blocksTaskId - Blocking task id
   * @param kind - Relationship kind
   * @returns `true` when the edge is present
   */
  exists(taskId: string, blocksTaskId: string, kind: DependencyKind): boolean {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT 1 FROM dependencies WHERE task_id = ? AND blocks_task_id = ? AND kind = ?')
      .get(taskId, blocksTaskId, kind);
    return row !== undefined;
  }

  /**
   * Inserts a new dependency row.
   *
   * @param input - Dependency fields
   * @returns The newly created dependency
   */
  insert(input: DependencyInsertInput): Dependency {
    const id = generateUuid();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO dependencies (id, task_id, blocks_task_id, kind, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.blocksTaskId, input.kind, isoNow());

    const created = this.findById(id);
    if (created === null) {
      throw new Error('dependency insert succeeded but row not found');
    }
    return created;
  }
}

function rowToDependency(row: DependencyRow): Dependency {
  return {
    id: row.id,
    taskId: row.task_id,
    blocksTaskId: row.blocks_task_id,
    kind: row.kind as DependencyKind,
    createdAt: row.created_at,
  };
}
