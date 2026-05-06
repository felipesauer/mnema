import type { Epic } from '../../../domain/entities/epic.js';
import { EpicState } from '../../../domain/enums/epic-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface EpicRow {
  readonly id: string;
  readonly key: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly metadata: string;
  readonly created_at: string;
  readonly closed_at: string | null;
  readonly deleted_at: string | null;
}

/**
 * Input for {@link EpicRepository.insert}.
 */
export interface EpicInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link Epic}.
 */
export class EpicRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns the next sequential number to use for an epic key, scoped
   * to a project.
   *
   * @param projectId - Internal project id
   * @returns The next available sequence (starts at 1)
   */
  nextSequence(projectId: string): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM epics WHERE project_id = ?')
      .get(projectId) as { n: number };
    return row.n + 1;
  }

  /**
   * Looks up an epic by its human-readable key.
   *
   * @param key - Epic key, e.g. `WEBAPP-EPIC-3`
   * @returns The epic or `null`
   */
  findByKey(key: string): Epic | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM epics WHERE key = ? AND deleted_at IS NULL')
      .get(key) as EpicRow | undefined;
    return row === undefined ? null : rowToEpic(row);
  }

  /**
   * Looks up an epic by its internal id.
   *
   * @param id - Internal UUID of the epic
   * @returns The epic or `null`
   */
  findById(id: string): Epic | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM epics WHERE id = ? AND deleted_at IS NULL')
      .get(id) as EpicRow | undefined;
    return row === undefined ? null : rowToEpic(row);
  }

  /**
   * Lists every epic of a project ordered by creation.
   *
   * @param projectId - Internal project id
   * @param state - Optional state filter
   * @returns Epics ordered by `created_at`
   */
  findByProject(projectId: string, state?: EpicState): Epic[] {
    const rows =
      state === undefined
        ? (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM epics
                WHERE project_id = ? AND deleted_at IS NULL
                ORDER BY created_at`,
            )
            .all(projectId) as EpicRow[])
        : (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM epics
                WHERE project_id = ? AND state = ? AND deleted_at IS NULL
                ORDER BY created_at`,
            )
            .all(projectId, state) as EpicRow[]);
    return rows.map(rowToEpic);
  }

  /**
   * Inserts a new epic in `OPEN` state.
   *
   * @param input - Epic fields
   * @returns The newly created epic
   */
  insert(input: EpicInsertInput): Epic {
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO epics (id, key, project_id, title, description, state, metadata)
         VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
      )
      .run(id, input.key, input.projectId, input.title, input.description ?? null, metadata);

    const created = this.findById(id);
    if (created === null) {
      throw new Error('epic insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Transitions an epic to a new state. Setting `CLOSED` stamps
   * `closed_at` automatically.
   *
   * @param epicId - Internal epic id
   * @param state - Target state
   * @returns The updated epic, or `null` when the id is unknown
   */
  updateState(epicId: string, state: EpicState): Epic | null {
    const closedClause =
      state === EpicState.Closed ? `, closed_at = datetime('now', 'subsec')` : '';
    this.adapter
      .getDatabase()
      .prepare(`UPDATE epics SET state = ?${closedClause} WHERE id = ?`)
      .run(state, epicId);
    return this.findById(epicId);
  }

  /**
   * Attaches a task to an epic by setting `tasks.epic_id`.
   *
   * @param epicId - Internal epic id
   * @param taskId - Internal task id
   */
  addTask(epicId: string, taskId: string): void {
    this.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET epic_id = ? WHERE id = ?')
      .run(epicId, taskId);
  }

  /**
   * Removes a task from its epic (clears `tasks.epic_id`).
   *
   * @param taskId - Internal task id
   */
  removeTask(taskId: string): void {
    this.adapter.getDatabase().prepare('UPDATE tasks SET epic_id = NULL WHERE id = ?').run(taskId);
  }

  /**
   * Lists every active task currently assigned to an epic.
   *
   * @param epicId - Internal epic id
   * @returns Task rows (raw) ordered by key
   */
  listTaskKeys(epicId: string): string[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT key FROM tasks
          WHERE epic_id = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(epicId) as { key: string }[];
    return rows.map((r) => r.key);
  }
}

function rowToEpic(row: EpicRow): Epic {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    state: row.state as EpicState,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    deletedAt: row.deleted_at,
  };
}
