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

import {
  type ChainLayout,
  catalogUpcasters,
  type EventKind,
  type UpcasterRegistry,
} from '@mnema/chain';
import { ensureSchema } from '../db/schema.js';
import { IN_MEMORY, openDatabase, type SqliteDatabase } from '../db/sqlite.js';
import type { ChannelSwitchProjection } from './channel.js';
import { getChannelSwitch, listChannelSwitches } from './channel-store.js';
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
  listLinksByRelation,
  listLinksFrom,
  listLinksTo,
  listMemories,
  listObservationsAbout,
} from './knowledge-store.js';
import { rebuild } from './rebuild.js';
import {
  type AuthorshipFilter,
  type AuthorshipTally,
  isKnownEntity,
  listAuthors,
  listReferences,
  listSubjectRuns,
  type ReferenceDirection,
  type ReferenceEdgeRow,
  type ReferenceRow,
  type ReferenceSeed,
  type SubjectRun,
  tallyAuthorship,
  walkReferences,
} from './reference-store.js';
import type { RunProjection } from './run.js';
import { getRun, listOpenRuns, listRuns } from './run-store.js';
import { type SearchQuery, type SearchResult, searchRecord } from './search-store.js';
import type { SkillProjection } from './skill.js';
import { getSkill, listSkills, listSkillsByState } from './skill-store.js';
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
   * Reports every `ADR-<n>` label carried by more than one decision of THIS
   * chain — a label collision to reconcile, never an error. Empty when every
   * label is unique.
   *
   * A cache is opened over one chain root, which is exactly the unit an
   * `ADR-<n>` is numbered in, so this asks the question at the only scope where
   * it has an answer. Its reader is the brief's composition (`brief` in
   * @mnema/copilot), which serves the label into a committed document and so has
   * to say when a label there names two rules.
   *
   * It reports EVERY decision of the chain, whatever state it is in: a label is
   * cited by a human, and a superseded or rejected decision still answers to the
   * one it was given. A reader that only wants the labels it is printing filters
   * on those — which is what the brief does.
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

  /**
   * Lists the knowledge links asserting the given relation, whatever their ends.
   * The read a rule's ADDRESS needs: an address covers a path by being a prefix
   * of it, so neither end is a key and the label is.
   */
  linksByRelation(rel: string): LinkEdge[] {
    return listLinksByRelation(this.db, rel);
  }

  /** Reads one skill by id, or null if it is not projected. */
  getSkill(id: string): SkillProjection | null {
    return getSkill(this.db, id);
  }

  /** Lists all projected skills, ordered by id. */
  listSkills(): SkillProjection[] {
    return listSkills(this.db);
  }

  /** Lists skills currently in the given state. */
  listSkillsByState(state: string): SkillProjection[] {
    return listSkillsByState(this.db, state);
  }

  /**
   * Where one of the product's own switches stands in this tree, or null when
   * nothing in it ever switched that channel — which is the channel being ON (see
   * {@link ChannelSwitchProjection}).
   */
  channelSwitch(channel: string): ChannelSwitchProjection | null {
    return getChannelSwitch(this.db, channel);
  }

  /** Every channel this tree ever switched, ordered by channel. */
  channelSwitches(): ChannelSwitchProjection[] {
    return listChannelSwitches(this.db);
  }

  /**
   * Searches this tree's record, or lists its most recent entries when the query
   * carries no term. Returns an INDEX — an id, a kind, an instant and one line
   * per hit — plus how many matched in all; the body of any one of them comes
   * from the by-id read above.
   */
  search(query: SearchQuery = {}): SearchResult {
    return searchRecord(this.db, query);
  }

  /**
   * Every event in this tree that touches `entityId` — as its subject, or by
   * referring to it — in the tree's own order, one entry per event. The
   * entity's history as this tree holds it.
   */
  references(entityId: string): ReferenceRow[] {
    return listReferences(this.db, entityId);
  }

  /**
   * True when some event in this tree has `entityId` as its subject. The test of
   * whether the record AUTHORED the thing, as opposed to merely pointing at it.
   */
  knows(entityId: string): boolean {
    return isKnownEntity(this.db, entityId);
  }

  /**
   * The authorship tally over this tree — how many facts each author wrote, by
   * kind and by executing agent — narrowed by the optional filter.
   */
  authorship(filter: AuthorshipFilter = {}): AuthorshipTally[] {
    return tallyAuthorship(this.db, filter);
  }

  /**
   * Every identity that authorized a fact in this tree, once each — who this tree
   * knows, without how much any of them wrote.
   */
  authors(): string[] {
    return listAuthors(this.db);
  }

  /**
   * Every event of `kind` in this tree, as its subject and the run it happened in
   * — one row per event, for a caller counting occurrences across trees.
   */
  subjectRuns(kind: EventKind): SubjectRun[] {
    return listSubjectRuns(this.db, kind);
  }

  /**
   * Walks this tree's reference graph from `seeds`, following edges in
   * `direction` for at most `maxDepth` hops, and returns the edges traversed.
   * Cycle-safe and capped by construction.
   */
  walk(
    seeds: readonly ReferenceSeed[],
    direction: ReferenceDirection,
    maxDepth: number,
  ): ReferenceEdgeRow[] {
    return walkReferences(this.db, seeds, direction, maxDepth);
  }

  /** Closes the underlying database. */
  close(): void {
    this.db.close();
  }
}
