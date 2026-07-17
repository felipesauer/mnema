import type { Project } from '../../../domain/entities/project.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface ProjectRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly config: string;
  readonly created_at: string;
  readonly deleted_at: string | null;
}

/**
 * Persistence for {@link Project}.
 */
export class ProjectRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds a project by its uppercase key, ignoring soft-deleted rows.
   *
   * @param key - Project key (e.g., `"WEBAPP"`)
   * @returns The project if active, `null` otherwise
   */
  findByKey(key: string): Project | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM projects WHERE key = ? AND deleted_at IS NULL')
      .get(key) as ProjectRow | undefined;
    return row === undefined ? null : rowToProject(row);
  }

  /**
   * Inserts a new project. Caller must ensure the key is unique.
   *
   * @param input - Fields required to create a project
   * @returns The newly created project
   */
  insert(input: {
    key: string;
    name: string;
    description?: string | null;
    config?: Record<string, unknown>;
  }): Project {
    const id = generateUuid();
    const config = JSON.stringify(input.config ?? {});
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO projects (id, key, name, description, config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.key, input.name, input.description ?? null, config, isoNow());

    const created = this.findByKey(input.key);
    if (created === null) {
      throw new Error('project insert succeeded but row not found');
    }
    return created;
  }
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    config: JSON.parse(row.config) as Record<string, unknown>,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}
