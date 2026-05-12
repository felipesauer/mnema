import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

/**
 * Polymorphic parent of an attachment row.
 */
export type AttachmentParentKind = 'task' | 'note' | 'decision';

interface AttachmentRow {
  readonly id: string;
  readonly parent_kind: string;
  readonly parent_id: string;
  readonly filename: string;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly hash: string;
  readonly uploaded_by: string;
  readonly metadata: string;
  readonly at: string;
  readonly deleted_at: string | null;
}

/**
 * Attachment metadata persisted in SQLite.
 *
 * The actual binary content lives under `<paths.state>/attachments/`
 * with file name `{sha256}.{ext}` (see {@link FileStore}). The `path`
 * column stores just the filename so a project move does not break
 * lookups; the resolver in the consumer joins it with the configured
 * state directory.
 */
export interface Attachment {
  readonly id: string;
  readonly parentKind: AttachmentParentKind;
  readonly parentId: string;
  readonly filename: string;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly hash: string;
  readonly uploadedBy: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly at: string;
  readonly deletedAt: string | null;
}

/**
 * Input for {@link AttachmentRepository.insert}.
 */
export interface AttachmentInsertInput {
  readonly parentKind: AttachmentParentKind;
  readonly parentId: string;
  readonly filename: string;
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  readonly hash: string;
  readonly uploadedBy: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for attachment metadata.
 */
export class AttachmentRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns an attachment by internal id.
   *
   * @param id - Attachment id
   * @returns The attachment or `null`
   */
  findById(id: string): Attachment | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(id) as AttachmentRow | undefined;
    return row === undefined ? null : rowToAttachment(row);
  }

  /**
   * Lists attachments for a parent entity (task, note or decision).
   *
   * @param kind - Parent kind
   * @param parentId - Parent identifier
   * @returns Active attachments ordered by attachment timestamp
   */
  findByParent(kind: AttachmentParentKind, parentId: string): Attachment[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM attachments
          WHERE parent_kind = ? AND parent_id = ? AND deleted_at IS NULL
          ORDER BY at`,
      )
      .all(kind, parentId) as AttachmentRow[];
    return rows.map(rowToAttachment);
  }

  /**
   * Returns the existing attachment row, if any, that already links
   * the given hash to the given parent — used by the service to avoid
   * inserting a duplicate row when the same content is re-attached.
   *
   * @param kind - Parent kind
   * @param parentId - Parent identifier
   * @param hash - SHA-256 hash of the content
   * @returns Existing attachment row or `null`
   */
  findByParentAndHash(
    kind: AttachmentParentKind,
    parentId: string,
    hash: string,
  ): Attachment | null {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM attachments
          WHERE parent_kind = ? AND parent_id = ? AND hash = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(kind, parentId, hash) as AttachmentRow | undefined;
    return row === undefined ? null : rowToAttachment(row);
  }

  /**
   * Lists every attachment for a given hash, regardless of parent.
   * Useful for dedup diagnostics.
   *
   * @param hash - SHA-256 hash
   * @returns Active attachments matching the hash
   */
  findByHash(hash: string): Attachment[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM attachments WHERE hash = ? AND deleted_at IS NULL ORDER BY at')
      .all(hash) as AttachmentRow[];
    return rows.map(rowToAttachment);
  }

  /**
   * Inserts an attachment metadata row.
   *
   * @param input - Attachment fields
   * @returns The newly created attachment
   */
  insert(input: AttachmentInsertInput): Attachment {
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO attachments (
           id, parent_kind, parent_id, filename, path,
           mime, size, hash, uploaded_by, metadata, at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.parentKind,
        input.parentId,
        input.filename,
        input.path,
        input.mime,
        input.size,
        input.hash,
        input.uploadedBy,
        metadata,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('attachment insert succeeded but row not found');
    }
    return created;
  }
}

function rowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    parentKind: row.parent_kind as AttachmentParentKind,
    parentId: row.parent_id,
    filename: row.filename,
    path: row.path,
    mime: row.mime,
    size: row.size,
    hash: row.hash,
    uploadedBy: row.uploaded_by,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    at: row.at,
    deletedAt: row.deleted_at,
  };
}
