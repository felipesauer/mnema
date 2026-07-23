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
import { type AdrCollision, adrCollisions, type DecisionProjection } from './decision.js';
import { getDecision, listDecisions, listDecisionsByState } from './decision-store.js';
import type {
  HandoffProjection,
  LinkEdge,
  MemoryProjection,
  ObservationProjection,
} from './knowledge.js';
import {
  getMemory,
  getObservation,
  listHandoffs,
  listLinksFrom,
  listLinksTo,
  listMemories,
  listObservationsAbout,
} from './knowledge-store.js';
import { rebuild } from './rebuild.js';
import type { RunProjection } from './run.js';
import { getRun, listOpenRuns, listRuns } from './run-store.js';
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

  /** Reads one run by id, or null if it is not projected. */
  getRun(id: string): RunProjection | null {
    return getRun(this.db, id);
  }

  /** Lists all projected runs, ordered by id. */
  listRuns(): RunProjection[] {
    return listRuns(this.db);
  }

  /** Lists the currently open runs (not yet ended). */
  listOpenRuns(): RunProjection[] {
    return listOpenRuns(this.db);
  }

  /** Reads one decision by id, or null if it is not projected. */
  getDecision(id: string): DecisionProjection | null {
    return getDecision(this.db, id);
  }

  /** Lists all projected decisions, ordered by id. */
  listDecisions(): DecisionProjection[] {
    return listDecisions(this.db);
  }

  /** Lists decisions currently in the given state. */
  listDecisionsByState(state: string): DecisionProjection[] {
    return listDecisionsByState(this.db, state);
  }

  /**
   * Reports every `ADR-<n>` label carried by more than one decision — a label
   * collision to reconcile, never an error. Empty when every label is unique.
   */
  adrCollisions(): AdrCollision[] {
    return adrCollisions(listDecisions(this.db));
  }

  /** Reads one captured memory by id, or null if it is not projected. */
  getMemory(id: string): MemoryProjection | null {
    return getMemory(this.db, id);
  }

  /** Lists all captured memories, ordered by id. */
  listMemories(): MemoryProjection[] {
    return listMemories(this.db);
  }

  /** Reads one observation by its own id, or null if it is not projected. */
  getObservation(id: string): ObservationProjection | null {
    return getObservation(this.db, id);
  }

  /** Lists the observations recorded about the given entity, oldest first. */
  listObservationsAbout(about: string): ObservationProjection[] {
    return listObservationsAbout(this.db, about);
  }

  /** Lists the handoffs recorded on the given task, oldest first. */
  listHandoffs(task: string): HandoffProjection[] {
    return listHandoffs(this.db, task);
  }

  /** Lists the knowledge links that originate FROM the given entity. */
  listLinksFrom(subject: string): LinkEdge[] {
    return listLinksFrom(this.db, subject);
  }

  /** Lists the knowledge links that point INTO the given entity. */
  listLinksTo(target: string): LinkEdge[] {
    return listLinksTo(this.db, target);
  }

  /** Closes the underlying database. */
  close(): void {
    this.db.close();
  }
}
