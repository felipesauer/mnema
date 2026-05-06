import type { Task } from '../../../domain/entities/task.js';
import type { TaskState } from '../../../domain/enums/task-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface TaskRow {
  readonly id: string;
  readonly key: string;
  readonly project_id: string;
  readonly epic_id: string | null;
  readonly sprint_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly acceptance_criteria: string;
  readonly state: string;
  readonly estimate: number | null;
  readonly priority: number;
  readonly assignee_id: string | null;
  readonly reporter_id: string;
  readonly reopen_count: number;
  readonly metadata: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly deleted_at: string | null;
}

/**
 * Input shape for {@link TaskRepository.insert}.
 */
export interface TaskInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly reporterId: string;
  readonly description?: string | null;
  readonly acceptanceCriteria?: readonly string[];
  readonly state?: TaskState;
  readonly estimate?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly epicId?: string | null;
  readonly sprintId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link Task}. Read/write only — no business rules.
 */
export class TaskRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds a task by its human-readable key, excluding soft-deleted rows.
   *
   * @param key - Task key (e.g., `"WEBAPP-42"`)
   * @returns The task if found, `null` otherwise
   */
  findByKey(key: string): Task | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM tasks WHERE key = ? AND deleted_at IS NULL')
      .get(key) as TaskRow | undefined;
    return row === undefined ? null : rowToTask(row);
  }

  /**
   * Lists tasks in the given state, ordered by key.
   *
   * @param state - State to filter by
   * @returns Array of matching tasks (possibly empty)
   */
  findByState(state: TaskState): Task[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM tasks
          WHERE state = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(state) as TaskRow[];
    return rows.map(rowToTask);
  }

  /**
   * Inserts a new task. Returns the persisted entity (with defaults
   * applied by the database).
   *
   * @param input - Fields required to create a task
   * @returns The newly created task
   */
  insert(input: TaskInsertInput): Task {
    const id = generateUuid();
    const acceptance = JSON.stringify(input.acceptanceCriteria ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO tasks (
           id, key, project_id, epic_id, sprint_id,
           title, description, acceptance_criteria, state,
           estimate, priority, assignee_id, reporter_id, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.key,
        input.projectId,
        input.epicId ?? null,
        input.sprintId ?? null,
        input.title,
        input.description ?? null,
        acceptance,
        input.state ?? 'DRAFT',
        input.estimate ?? null,
        input.priority ?? 3,
        input.assigneeId ?? null,
        input.reporterId,
        metadata,
      );

    const created = this.findByKey(input.key);
    if (created === null) {
      throw new Error('task insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Counts the number of tasks visible (not soft-deleted).
   *
   * @returns Total number of active tasks
   */
  countActive(): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL')
      .get() as { n: number };
    return row.n;
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    epicId: row.epic_id,
    sprintId: row.sprint_id,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria) as string[],
    state: row.state as TaskState,
    estimate: row.estimate,
    priority: row.priority,
    assigneeId: row.assignee_id,
    reporterId: row.reporter_id,
    reopenCount: row.reopen_count,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    deletedAt: row.deleted_at,
  };
}
