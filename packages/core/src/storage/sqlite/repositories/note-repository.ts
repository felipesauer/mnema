import type { Note, NoteKind } from '../../../domain/entities/note.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface NoteRow {
  readonly id: string;
  readonly task_id: string;
  readonly actor_id: string;
  readonly kind: string;
  readonly content: string;
  readonly metadata: string;
  readonly at: string;
  readonly deleted_at: string | null;
}

/**
 * Input for {@link NoteRepository.insert}.
 */
export interface NoteInsertInput {
  readonly taskId: string;
  readonly actorId: string;
  readonly kind: NoteKind;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link Note}.
 */
export class NoteRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns a note by internal id.
   *
   * @param id - Note id
   * @returns The note or `null`
   */
  findById(id: string): Note | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL')
      .get(id) as NoteRow | undefined;
    return row === undefined ? null : rowToNote(row);
  }

  /**
   * Lists every active note attached to a task, ordered by record time.
   *
   * @param taskId - Internal task id
   * @param kind - Optional kind filter
   * @returns Notes ordered by `at`
   */
  findByTask(taskId: string, kind?: NoteKind): Note[] {
    const rows =
      kind === undefined
        ? (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM notes
                WHERE task_id = ? AND deleted_at IS NULL
                ORDER BY at`,
            )
            .all(taskId) as NoteRow[])
        : (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM notes
                WHERE task_id = ? AND kind = ? AND deleted_at IS NULL
                ORDER BY at`,
            )
            .all(taskId, kind) as NoteRow[]);
    return rows.map(rowToNote);
  }

  /**
   * Inserts a new note row.
   *
   * @param input - Note fields
   * @returns The newly created note
   */
  insert(input: NoteInsertInput): Note {
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO notes (id, task_id, actor_id, kind, content, metadata, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.actorId, input.kind, input.content, metadata, isoNow());

    const created = this.findById(id);
    if (created === null) {
      throw new Error('note insert succeeded but row not found');
    }
    return created;
  }
}

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    kind: row.kind as NoteKind,
    content: row.content,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    at: row.at,
    deletedAt: row.deleted_at,
  };
}
