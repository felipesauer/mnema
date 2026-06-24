import type { EvidenceKind, TaskEvidence } from '../../../domain/entities/task-evidence.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface TaskEvidenceRow {
  readonly id: string;
  readonly task_id: string;
  readonly criterion_index: number;
  readonly criterion_text: string | null;
  readonly kind: string;
  readonly ref: string;
  readonly note: string | null;
  readonly created_at: string;
}

/**
 * Input for {@link TaskEvidenceRepository.insert}.
 */
export interface TaskEvidenceInsertInput {
  readonly taskId: string;
  readonly criterionIndex: number;
  /** The criterion's text at attach time; enables identity-based reconciliation. */
  readonly criterionText?: string | null;
  readonly kind: EvidenceKind;
  readonly ref: string;
  readonly note?: string | null;
}

/**
 * Persistence for {@link TaskEvidence} (migration 013). `created_at` is
 * written with {@link isoNow} rather than relying on the SQL default.
 */
export class TaskEvidenceRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns an evidence row by id.
   *
   * @param id - Evidence id
   * @returns The evidence or `null`
   */
  findById(id: string): TaskEvidence | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM task_evidence WHERE id = ?')
      .get(id) as TaskEvidenceRow | undefined;
    return row === undefined ? null : rowToEvidence(row);
  }

  /**
   * Lists every evidence row for a task, ordered by criterion then time.
   *
   * @param taskId - Internal task id
   * @returns Evidence rows
   */
  findByTask(taskId: string): TaskEvidence[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM task_evidence
          WHERE task_id = ?
          ORDER BY criterion_index, created_at`,
      )
      .all(taskId) as TaskEvidenceRow[];
    return rows.map(rowToEvidence);
  }

  /**
   * Checks whether an identical evidence edge already exists.
   *
   * @param taskId - Task id
   * @param criterionIndex - Criterion position
   * @param kind - Evidence kind
   * @param ref - Reference
   * @returns `true` when present
   */
  exists(taskId: string, criterionIndex: number, kind: EvidenceKind, ref: string): boolean {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT 1 FROM task_evidence
          WHERE task_id = ? AND criterion_index = ? AND kind = ? AND ref = ?`,
      )
      .get(taskId, criterionIndex, kind, ref);
    return row !== undefined;
  }

  /**
   * Inserts a new evidence row.
   *
   * @param input - Evidence fields
   * @returns The created evidence
   */
  insert(input: TaskEvidenceInsertInput): TaskEvidence {
    const id = generateUuid();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO task_evidence
           (id, task_id, criterion_index, criterion_text, kind, ref, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.criterionIndex,
        input.criterionText ?? null,
        input.kind,
        input.ref,
        input.note ?? null,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('task_evidence insert succeeded but row not found');
    }
    return created;
  }
}

function rowToEvidence(row: TaskEvidenceRow): TaskEvidence {
  return {
    id: row.id,
    taskId: row.task_id,
    criterionIndex: row.criterion_index,
    // Drift-tolerant: the column is absent on a DB stopped before migration
    // 016, so SELECT * yields `undefined` → normalise to null.
    criterionText: row.criterion_text ?? null,
    kind: row.kind as EvidenceKind,
    ref: row.ref,
    note: row.note,
    createdAt: row.created_at,
  };
}
