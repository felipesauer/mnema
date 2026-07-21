/**
 * The projection cache: the read model over a chain.
 *
 * It owns a SQLite database of projections derived from the chain and answers
 * queries against them. The database is a pure cache — {@link ProjectionCache.rebuild}
 * drops it and replays the chain, and nothing else writes state into it. Open
 * it against a chain root, rebuild to populate, then query.
 *
 * The chain stays the source of truth; this is a materialized, queryable view
 * of it that can be discarded and rebuilt at any time.
 */

import { type ChainLayout, catalogUpcasters, type UpcasterRegistry } from '@mnema/chain';
import { ensureSchema } from '../db/schema.js';
import { IN_MEMORY, openDatabase, type SqliteDatabase } from '../db/sqlite.js';
import { rebuild } from './rebuild.js';
import type { TaskProjection } from './task.js';
import { getTask, listTasks, listTasksByState } from './task-store.js';

/** Options for opening a cache. */
export interface CacheOptions {
  /**
   * Where to store the SQLite file. Defaults to in-memory — a cache that lives
   * only for the process, rebuilt on open. A persistent path arrives with the
   * surfaces that need a warm cache across runs.
   */
  readonly dbPath?: string;
  /** Upcaster registry for reading the chain; defaults to the catalog's. */
  readonly upcasters?: UpcasterRegistry;
}

export class ProjectionCache {
  private constructor(
    private readonly db: SqliteDatabase,
    private readonly layout: ChainLayout,
    private readonly upcasters: UpcasterRegistry,
  ) {}

  /**
   * Opens a cache over the chain rooted at `chainRoot`. Ensures the schema
   * exists but does NOT rebuild — call {@link rebuild} to populate from the
   * chain (an in-memory cache is empty until then).
   */
  static open(chainRoot: string, options: CacheOptions = {}): ProjectionCache {
    const db = openDatabase(options.dbPath ?? IN_MEMORY);
    ensureSchema(db);
    const cache = new ProjectionCache(
      db,
      { root: chainRoot },
      options.upcasters ?? catalogUpcasters(),
    );
    return cache;
  }

  /** Drops the cache and replays it from the chain. Safe to call any time. */
  rebuild(): void {
    rebuild(this.db, this.layout, this.upcasters);
  }

  /** Reads one task by id, or null if it is not projected. */
  getTask(id: string): TaskProjection | null {
    return getTask(this.db, id);
  }

  /** Lists all projected tasks, ordered by id. */
  listTasks(): TaskProjection[] {
    return listTasks(this.db);
  }

  /** Lists tasks currently in the given state. */
  listTasksByState(state: string): TaskProjection[] {
    return listTasksByState(this.db, state);
  }

  /** Closes the underlying database. */
  close(): void {
    this.db.close();
  }
}
