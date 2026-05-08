import type { Sprint } from '../../../domain/entities/sprint.js';
import type { Task } from '../../../domain/entities/task.js';
import { SprintState } from '../../../domain/enums/sprint-state.js';
import type { TaskState } from '../../../domain/enums/task-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface SprintRow {
  readonly id: string;
  readonly key: string;
  readonly project_id: string;
  readonly name: string;
  readonly goal: string | null;
  readonly state: string;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly capacity: number | null;
  readonly metadata: string;
  readonly created_at: string;
  readonly closed_at: string | null;
  readonly deleted_at: string | null;
}

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
 * Input for {@link SprintRepository.insert}.
 */
export interface SprintInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly name: string;
  readonly goal?: string | null;
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
  readonly capacity?: number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link Sprint}. The unique partial index on
 * `(project_id) WHERE state='ACTIVE'` enforces the "one active sprint
 * per project" invariant at the database level.
 */
export class SprintRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns the next sequential number to use for a sprint key.
   *
   * @param projectId - Internal project id
   * @returns The next available sequence (starts at 1)
   */
  nextSequence(projectId: string): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM sprints WHERE project_id = ?')
      .get(projectId) as { n: number };
    return row.n + 1;
  }

  /**
   * Looks up a sprint by its human-readable key.
   *
   * @param key - Sprint key, e.g. `WEBAPP-SPRINT-3`
   * @returns The sprint or `null`
   */
  findByKey(key: string): Sprint | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM sprints WHERE key = ? AND deleted_at IS NULL')
      .get(key) as SprintRow | undefined;
    return row === undefined ? null : rowToSprint(row);
  }

  /**
   * Looks up a sprint by internal id.
   *
   * @param id - Internal UUID of the sprint
   * @returns The sprint or `null`
   */
  findById(id: string): Sprint | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM sprints WHERE id = ? AND deleted_at IS NULL')
      .get(id) as SprintRow | undefined;
    return row === undefined ? null : rowToSprint(row);
  }

  /**
   * Returns the active sprint for a project, or `null` when none.
   *
   * @param projectId - Internal project id
   * @returns The active sprint or `null`
   */
  findActive(projectId: string): Sprint | null {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM sprints
          WHERE project_id = ? AND state = 'ACTIVE' AND deleted_at IS NULL`,
      )
      .get(projectId) as SprintRow | undefined;
    return row === undefined ? null : rowToSprint(row);
  }

  /**
   * Lists every sprint of a project ordered by creation.
   *
   * @param projectId - Internal project id
   * @returns Sprints ordered by `created_at`
   */
  findByProject(projectId: string): Sprint[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM sprints
          WHERE project_id = ? AND deleted_at IS NULL
          ORDER BY created_at`,
      )
      .all(projectId) as SprintRow[];
    return rows.map(rowToSprint);
  }

  /**
   * Inserts a new sprint in `PLANNED` state.
   *
   * @param input - Sprint fields
   * @returns The newly created sprint
   */
  insert(input: SprintInsertInput): Sprint {
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO sprints (
           id, key, project_id, name, goal,
           state, starts_at, ends_at, capacity, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, 'PLANNED', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.key,
        input.projectId,
        input.name,
        input.goal ?? null,
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.capacity ?? null,
        metadata,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('sprint insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Transitions a sprint to a new state. Setting `CLOSED` stamps
   * `closed_at` automatically.
   *
   * @param sprintId - Internal sprint id
   * @param state - Target state
   * @returns The updated sprint, or `null` when the id is unknown
   */
  updateState(sprintId: string, state: SprintState): Sprint | null {
    const isClosing = state === SprintState.Closed;
    const closedClause = isClosing ? `, closed_at = ?` : '';
    const stmt = this.adapter
      .getDatabase()
      .prepare(`UPDATE sprints SET state = ?${closedClause} WHERE id = ?`);
    if (isClosing) {
      stmt.run(state, isoNow(), sprintId);
    } else {
      stmt.run(state, sprintId);
    }
    return this.findById(sprintId);
  }

  /**
   * Attaches a task to a sprint by setting `tasks.sprint_id`.
   *
   * @param sprintId - Internal sprint id
   * @param taskId - Internal task id
   */
  addTask(sprintId: string, taskId: string): void {
    this.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET sprint_id = ? WHERE id = ?')
      .run(sprintId, taskId);
  }

  /**
   * Removes a task from its sprint (clears `tasks.sprint_id`).
   *
   * @param taskId - Internal task id
   */
  removeTask(taskId: string): void {
    this.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET sprint_id = NULL WHERE id = ?')
      .run(taskId);
  }

  /**
   * Lists every active task currently assigned to a sprint.
   *
   * @param sprintId - Internal sprint id
   * @returns Tasks ordered by key
   */
  listTasks(sprintId: string): Task[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM tasks
          WHERE sprint_id = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(sprintId) as TaskRow[];
    return rows.map(rowToTask);
  }
}

function rowToSprint(row: SprintRow): Sprint {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    state: row.state as SprintState,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    deletedAt: row.deleted_at,
  };
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
