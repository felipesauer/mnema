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
  type CatalogEvent,
  type ChainLayout,
  catalogUpcasters,
  type EventKind,
  type LinkBreak,
  type UpcasterRegistry,
} from '@mnema/chain';
import { ensureSchema } from '../db/schema.js';
import { IN_MEMORY, openDatabase, type SqliteDatabase } from '../db/sqlite.js';
import type { ChannelSwitchProjection } from './channel.js';
import { getChannelSwitch, listChannelSwitches } from './channel-store.js';
import { type AdrCollision, adrCollisions, type DecisionProjection } from './decision.js';
import { getDecision, listDecisions, listDecisionsByState } from './decision-store.js';
import { tablesFedBy } from './fed-by.js';
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
import { type ChainFrontier, chainArrivals, chainReplay } from './order.js';
import { advance, rebuild } from './rebuild.js';
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
   * only for the process, rebuilt on open.
   *
   * NO PRODUCTION CALLER SETS IT, and that is a fact rather than a gap waiting to
   * be filled. This said "a persistent path arrives with the surfaces that need a
   * warm cache across runs"; the surface arrived and chose otherwise. The MCP
   * session holds a cache warm for the length of the session
   * (`code/src/mcp/cache-registry.ts`) and opens it with `upcasters` alone, as does
   * every production site that opens a cache — a warm cache IN the process turned
   * out to be what that surface needed, and a file on disk would add an
   * invalidation nobody has to do today.
   *
   * THE SENTENCE ABOVE USED TO SAY "all six `ProjectionCache.open` sites in the
   * workspace" AND THE SIX WERE PAID FOR. Three of them opened a cache and never
   * closed it, so `code/src/tree-sources.ts` took the pairing over and `code` now
   * opens one in two places, guarded by
   * `code/tests/the-record-is-opened-and-closed-together.test.ts`. The count is gone
   * rather than corrected: it was a number about another package, in a doc-comment
   * that cannot be red when it goes stale, and it went stale the first time anything
   * moved. What holds is the claim it was evidence FOR — no production caller sets
   * this option — and that one is asserted where the callers live.
   *
   * WHAT IT IS FOR, then, is the property no in-memory cache can demonstrate:
   * `cache.test.ts` and `advance.test.ts` open a path, close it, open it again and
   * assert the tables survived. That is a real capability of this class and the
   * option is how it is reached, so it stays — named here rather than left looking
   * like plumbing somebody forgot to connect, which is the shape this workspace has
   * paid for four times.
   */
  readonly dbPath?: string;
  /** Upcaster registry for reading the chain; defaults to the catalog's. */
  readonly upcasters?: UpcasterRegistry;
}

export class ProjectionCache {
  /**
   * The order the tables were last built from, and how far into the chain it
   * reached. Retained because reading the chain is a third of what a rebuild costs
   * and the order is the whole input to every fold: holding it is what lets
   * {@link refresh} bring the cache forward without asking the disk for anything
   * but what arrived.
   *
   * Undefined until the first replay, which is the state {@link refresh} reads as
   * "there is nothing to bring forward".
   */
  private order: readonly CatalogEvent[] = [];
  private frontier: ChainFrontier | undefined;
  /**
   * The tails of this tree that do not chain, as of the last replay.
   *
   * It is held HERE rather than asked for on demand because it is a by-product of the
   * reading that already happened — asking again would mean reading the chain a second
   * time to learn something the first reading had in its hands. The reads that serve
   * this cache take it from {@link linkBreaks}.
   *
   * {@link refresh} DOES NOT LEAVE IT STALE FOR A BREAK THAT ARRIVED, and that is a
   * repaired promise rather than an original one. The premise this said for two
   * deliveries was that the incremental path refuses a broken run of arrivals
   * (`AN_ARRIVAL_DOES_NOT_CHAIN`), so any break appearing after the last full replay
   * forces one. MEASURED, THAT WAS FALSE FOR THE COMMONEST SHAPE: over a tail whose
   * last entry had been appended a second time, a fresh {@link rebuild} reported ONE
   * break and `refresh()` on a cache opened before it reported ZERO.
   *
   * The refusal was never the hole — WHERE THE ARRIVALS WERE READ FROM was. A reading
   * resumed from the last `seq` asks the tail for the entries above it, and the walk
   * that answers stops at the first entry CARRYING that seq, which the duplicate
   * satisfies: nothing arrived, so there was no run of arrivals to find broken. The
   * frontier now records the BYTE each tail was read to ({@link TailReach.boundary}),
   * and past that byte the duplicate is an arrival like any other, which the refusal
   * then rules on.
   *
   * THAT PARAGRAPH THEN CLAIMED THE REPAIR WAS TOTAL, in the words *"the three shapes it
   * was measured over — the last entry duplicated, the last two, the last three — all now
   * agree with a fresh rebuild"*, AND THREE SHAPES WERE NOT THE RULE. All three are a
   * duplicated `seq`, which is one of the three ways `linkBreakAt` says a tail stops
   * chaining, and the refusal was asking a seq test of its own rather than that function.
   * Measured, one rule over: with the boundary entry REPLACED by a different entry of the
   * same seq, a fresh {@link rebuild} reported `prev-hash break` and `refresh()` on a
   * retained cache called the same bytes a sound suffix and advanced over them. The
   * frontier carries the boundary HASH now ({@link TailReach.lastHash}) and the refusal is
   * `firstLinkBreakFrom`, the same function a whole-tail read asks — so the agreement is
   * with the rule rather than with a list of shapes somebody thought of.
   *
   * WHAT IS STILL OUTSIDE IT is a break BELOW the boundary: bytes a previous reading
   * already accepted and will not read again. Rewriting the past under a live session
   * is invisible here for as long as that session stays up, and a connection that opens
   * afterwards replays and is told. That is a limit with a measurement, not a silence:
   * `order.test.ts` holds both halves.
   *
   * AND IT REACHES ONLY THE SURFACE THAT READS — which was true of this field and is no
   * longer true of the class. It said *"a write does not refresh anything, so a connection
   * that writes without reading after the break is told nothing until its next read"*. The
   * write still refreshes nothing, and that is deliberate: a catch-up per write costs what
   * a reader pays once and grows with the record. What changed is that a write no longer
   * has to read this field to be answered — {@link linkBreaksAsOfNow} asks the chain
   * without advancing anything, at a price flat in the history, and
   * `code/tests/the-write-says-what-it-landed-on.test.ts` holds the new end-to-end.
   */
  private breaks: readonly LinkBreak[] = [];

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
    const replay = chainReplay(this.layout, this.upcasters);
    rebuild(this.db, replay.events);
    this.order = replay.events;
    this.frontier = replay.frontier;
    this.breaks = replay.linkBreaks;
  }

  /**
   * Where this tree's record stops chaining — empty for every record the product
   * wrote on its own, and the one thing a READ can say about the proof without paying
   * for `verify`.
   *
   * It answers a question no projection can: the tables are built from the events in
   * order, and a duplicate `seq` puts BOTH events in them, so a search over a broken
   * record looks exactly like a search over an intact one. The fact that the two
   * cannot both be in the right place lives in the entries' links, which the
   * projections do not carry, so the reading has to hand it up or it is gone.
   *
   * It does NOT mean the record is otherwise sound, and no reader may print it as if
   * it did: signatures, checkpoints and witnesses are not asked here. `verify` rules.
   */
  get linkBreaks(): readonly LinkBreak[] {
    return this.breaks;
  }

  /**
   * The same question as {@link linkBreaks}, asked of the chain AS IT IS NOW rather than
   * as the last replay found it — and it brings nothing forward.
   *
   * WHY IT IS A SECOND QUESTION AND NOT A REFRESH. {@link linkBreaks} answers from the
   * replay this cache holds, so a surface that has not read since another process appended
   * is told what its last read knew. The obvious repair is to {@link refresh} first, and
   * that was built and MEASURED and is the wrong price: the expensive half of a catch-up
   * is ADVANCING the projections over the arrivals, and a door that pays it per call pays
   * it where a reader pays it once — `+12.7 ms over a 60-entry record and +21.3 ms over a
   * 400-entry one` for a session of five writes and a read, growing with the history
   * (`code/src/mcp/tools.ts`, which is the door that asks this).
   *
   * Reading the arrivals is what carries the breaks; advancing is what costs. So this
   * reads and does not advance: THE COST IS ONE `readdir` PER TAIL AND THE ENTRIES PAST
   * THE BOUNDARY, and over a chain nothing appended to that is one entry per tail.
   * Measured over one tree, two rounds, arms placed `base · this · this · base`, against a
   * base-against-base ruler of 0.0014-0.0018 ms: **0.083 and 0.094 ms over a 60-entry
   * record, 0.094 and 0.091 ms over a 400-entry one** with the chain standing still, and
   * **0.095 and 0.091 ms** with five appends of another writer waiting. FLAT IN THE
   * HISTORY, which is the property, where a whole refresh is 1.96 ms at 60 entries and
   * 4.78 ms at 400.
   *
   * A COST STUDY PUT THIS AT 0.446 ms AND IT DID NOT REPRODUCE — it is five times smaller
   * here. The number is not corrected in place because the shape of the claim survived
   * intact and only the size moved: what that study measured, and what this asserts, is
   * that the price does not grow with the record.
   *
   * WHAT IT DOES NOT ANSWER, and a caller may not read silence here as soundness:
   *   - It is not a verdict, exactly as {@link linkBreaks} is not. Signatures,
   *     checkpoints and witnesses are `verify`'s.
   *   - A break BELOW this cache's frontier — bytes a previous reading already took — is
   *     outside it, for the same reason it is outside {@link refresh}.
   *   - Among the arrivals it names the FIRST break of the FIRST tail that has one, where
   *     a full replay names one per tail. A chain that changed in a way no suffix
   *     describes — a tail removed, a tail cut, a fact arriving stamped before something
   *     already covered — is not a break at all and answers as this cache already stood.
   *
   * It leaves this cache exactly as it found it: the tables, the order and the frontier
   * are untouched, so the next {@link refresh} does the same work it would have done.
   */
  linkBreaksAsOfNow(): readonly LinkBreak[] {
    if (this.frontier === undefined) return this.breaks;
    const arrived = chainArrivals(this.layout, this.upcasters, this.frontier);
    if (arrived.suffix || arrived.why !== 'AN_ARRIVAL_DOES_NOT_CHAIN') return this.breaks;
    // One break per tail, which is what a full reading reports: a tail this cache already
    // knows is broken does not gain a second line for a later break on the same tail.
    if (this.breaks.some((known) => known.tail === arrived.broke.tail)) return this.breaks;
    return [...this.breaks, arrived.broke];
  }

  /**
   * Brings the cache into agreement with the chain, doing the least work that is
   * sound — and it is the call a reader wants, not {@link rebuild}.
   *
   * A chain that only GREW since the last replay is brought forward from what
   * arrived: the arrivals are read (their own entries, not the chain), appended to
   * the order already in hand, folded, and written into the tables those arrivals
   * actually feed. A chain that changed any other way — a tail pruned, a tail gone,
   * a fact arriving stamped before something already covered — cannot be described
   * as a suffix, and this replays the whole thing.
   *
   * It is not a cheaper rebuild, it is the same result by a shorter route: the
   * tables it leaves behind are byte-identical to the ones a full replay would have
   * written, which is asserted for one event of every kind in the catalog
   * (`advance.test.ts`). Nothing here decides what a projection CONTAINS.
   */
  refresh(): void {
    if (this.frontier === undefined) {
      this.rebuild();
      return;
    }
    const arrived = chainArrivals(this.layout, this.upcasters, this.frontier);
    if (!arrived.suffix) {
      this.rebuild();
      return;
    }
    if (arrived.events.length === 0) return;
    const order = [...this.order, ...arrived.events];
    advance(
      this.db,
      order,
      arrived.events,
      this.order.length,
      tablesFedBy(arrived.events.map((event) => event.kind)),
    );
    this.order = order;
    this.frontier = arrived.frontier;
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
