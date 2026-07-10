import type { Actor } from '../../../domain/entities/actor.js';
import type { ActorKind } from '../../../domain/enums/actor-kind.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface ActorRow {
  readonly id: string;
  readonly handle: string;
  readonly kind: string;
  readonly display: string | null;
  readonly metadata: string;
  readonly created_at: string;
  readonly deleted_at: string | null;
}

/**
 * Persistence for {@link Actor}. Read/write only — no business rules.
 */
export class ActorRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds an actor by its unique handle.
   *
   * @param handle - Actor handle (e.g., `"daniel"` or `"agent:claude-code"`)
   * @returns The actor if found, `null` otherwise
   */
  findByHandle(handle: string): Actor | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM actors WHERE handle = ?')
      .get(handle) as ActorRow | undefined;
    return row === undefined ? null : rowToActor(row);
  }

  /**
   * Returns the actor with the given internal id, or `null` if missing.
   *
   * @param id - Internal UUID of the actor
   * @returns The actor or `null`
   */
  findById(id: string): Actor | null {
    const row = this.adapter.getDatabase().prepare('SELECT * FROM actors WHERE id = ?').get(id) as
      | ActorRow
      | undefined;
    return row === undefined ? null : rowToActor(row);
  }

  /**
   * Lists every active (non-deleted) actor, ordered by handle. The roster
   * an agent can read to learn which handles are valid assignees without
   * running a CLI.
   *
   * @returns Active actors ordered by handle
   */
  listActive(): Actor[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM actors WHERE deleted_at IS NULL ORDER BY handle')
      .all() as ActorRow[];
    return rows.map(rowToActor);
  }

  /**
   * Inserts an actor or returns the existing one's id when the handle
   * is already known. Useful for the "ensure" pattern in IdentityService.
   *
   * @param handle - Unique actor handle
   * @param kind - Whether the actor is a human or an agent
   * @param display - Optional human-friendly display name
   * @returns The actor's internal id (existing or newly generated)
   */
  upsert(handle: string, kind: ActorKind, display: string | null = null): string {
    const existing = this.findByHandle(handle);
    if (existing !== null) return existing.id;

    const id = generateUuid();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO actors (id, handle, kind, display, metadata, created_at)
         VALUES (?, ?, ?, ?, '{}', ?)`,
      )
      .run(id, handle, kind, display, isoNow());
    return id;
  }
}

function rowToActor(row: ActorRow): Actor {
  return {
    id: row.id,
    handle: row.handle,
    kind: row.kind as ActorKind,
    display: row.display,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}
