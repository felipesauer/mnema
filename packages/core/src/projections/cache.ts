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
  type LinkBreak,
  listTails,
  projectionCachePath,
  type UpcasterRegistry,
} from '@mnema/chain';
import { dropProjections, ensureSchema } from '../db/schema.js';
import { IN_MEMORY, openDatabase, type SqliteDatabase } from '../db/sqlite.js';
import { type FoundedBeside, identitiesFoundedBeside } from '../identity/founded-beside.js';
import { rosterIn, rosterOf } from '../identity/membership.js';
import { advance } from './advance.js';
import {
  type CacheMeta,
  productStamp,
  readGeneration,
  readMeta,
  sealedFingerprints,
  sealedSegmentsHold,
  writeMeta,
} from './cache-meta.js';
import type { ChannelSwitchProjection } from './channel.js';
import { getChannelSwitch, listChannelSwitches } from './channel-store.js';
import { type AdrCollision, adrCollisions, type DecisionProjection } from './decision.js';
import {
  countDecisions,
  getDecision,
  listDecisions,
  listDecisionsByState,
} from './decision-store.js';
import type { DivergentMove } from './divergent-moves.js';
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
import {
  type PertinenceQuery,
  type SearchQuery,
  type SearchResult,
  searchPertinent,
  searchRecord,
} from './search-store.js';
import type { SkillProjection } from './skill.js';
import { getSkill, listSkills, listSkillsByState } from './skill-store.js';
import { readDivergences, readMembership } from './state-store.js';
import type { TaskProjection } from './task.js';
import { getTask, listTasks, listTasksByState } from './task-store.js';

/** How many times a refresh reads the arrivals again because another process advanced the file first. */
const MAX_REFRESH_ATTEMPTS = 3;

/** A database that lives for the process, with the schema in it. */
function openMemory(): SqliteDatabase {
  const db = openDatabase(IN_MEMORY);
  ensureSchema(db);
  return db;
}

/** Options for opening a cache. */
export interface CacheOptions {
  /**
   * Where to store the SQLite file, named outright. Defaults to in-memory — a cache that
   * lives only for the process, rebuilt on open — unless {@link persist} says otherwise.
   *
   * A path named here is the CALLER'S and is used as given: a file that cannot be opened is
   * an error, where {@link persist} falls back to memory. It is what the tests that open a
   * path, close it, open it again and assert the tables survived are written against
   * (`cache.test.ts`, `advance.test.ts`).
   *
   * THIS SAID "NO PRODUCTION CALLER SETS IT, and that is a fact rather than a gap waiting to
   * be filled", for a warm cache the MCP session holds in the process and a file that "would
   * add an invalidation nobody has to do today". The second half is what stopped being true:
   * measured at 100 thousand events, a command line that rebuilds in memory on every read
   * pays 3.3 s and 548 MB for a question a warm cache answers in a millisecond, and the two
   * hooks that open a session are such reads (`measurements/the-record-at-scale/`). The
   * invalidation is done now — see {@link persist} — and the production caller is the one
   * option that does it, not this one.
   */
  readonly dbPath?: string;
  /**
   * Keep the cache in the tree it is built from (`projectionCachePath`), so that the next
   * process to open it takes only what was appended since — the command line, whose every
   * read used to build the whole projection and throw it away.
   *
   * It is a cache and never the record, and four things say so in code rather than in prose:
   *
   *   - what is in it is brought forward by {@link refresh} only when the chain's own
   *     reading says the new events FOLLOW what the cache covers (`chainArrivals`); any other
   *     change — a tail removed or cut, a fact stamped before something covered — replays;
   *   - it carries the stamp of the code that wrote it, and a stamp that is not this code's
   *     replays (`cache-meta.ts`);
   *   - a sealed segment whose size or modification time is not what the cache recorded
   *     replays, so a rewrite of what was already read is not served in silence;
   *   - a file that cannot be had — the directory is read-only, the database is corrupt, a
   *     writer held it past the wait — is not an error: the cache lives in memory for this
   *     process and answers the same, slower. DELETING IT CHANGES NO ANSWER.
   *
   * What it does not promise is what a reading that resumes can never promise: that bytes the
   * last reading already accepted were not edited since. `cache-meta.ts` says where the line
   * is, and `verify` is what rules past it.
   */
  readonly persist?: boolean;
  /** Upcaster registry for reading the chain; defaults to the catalog's. */
  readonly upcasters?: UpcasterRegistry;
}

/** A SQLite failure — a busy file, a corrupt one, a full disk — as opposed to one of the chain's. */
function isSqliteFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_');
}

export class ProjectionCache {
  /**
   * How far into the chain the tables reach, and with it everything {@link refresh} needs in
   * order to take only what arrived: the byte each tail was read to and the hash it ended on.
   * Undefined until the tables have been built (or loaded from a file that was), which is the
   * state {@link refresh} reads as "there is nothing to bring forward".
   *
   * THE ORDER IS NOT HELD. It used to be, retained so that a refresh could fold it all again,
   * and it was the whole of what a session cost in memory (1.0 GB at 100 thousand events) and
   * of what a refresh cost in time (0.65-0.73 s for one arrival). The folds are brought
   * forward from the accumulators in the tables now (`advance.ts`), and the three readings
   * that asked the order about itself read tables of their own (`membership_facts`,
   * `divergences`).
   */
  private frontier: ChainFrontier | undefined;
  /**
   * The tails of this tree that do not chain, as of the last replay or advance.
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
   * `order.test.ts` holds both halves. (A cache kept on disk narrows it: the sealed
   * segments' fingerprints are checked when one is loaded, so a connection that opens
   * after a rewrite of a sealed segment is still told — `cache-meta.ts`.)
   *
   * AND IT REACHES ONLY THE SURFACE THAT READS — which was true of this field and is no
   * longer true of the class. It said *"a write does not refresh anything, so a connection
   * that writes without reading after the break is told nothing until its next read"*. The
   * write still refreshes nothing, and that is deliberate: a catch-up per write costs what
   * a reader pays once and grows with the history. What changed is that a write no longer
   * has to read this field to be answered — {@link linkBreaksAsOfNow} asks the chain
   * without advancing anything, at a price flat in the history, and
   * `code/tests/the-write-says-what-it-landed-on.test.ts` holds the new end-to-end.
   */
  private breaks: readonly LinkBreak[] = [];
  /**
   * The generation of the cache file this instance last agreed with. A file other processes
   * write moves it, and an instance that finds the file ahead of it takes the frontier the
   * file carries rather than the one it remembers.
   */
  private generation = -1;

  private constructor(
    private db: SqliteDatabase,
    private readonly layout: ChainLayout,
    private readonly upcasters: UpcasterRegistry,
    /** Whether the database is a file other processes share — false for memory, and after a fallback to it. */
    private persisted: boolean,
  ) {}

  /**
   * Opens a cache over the chain rooted at `chainRoot`. Ensures the schema
   * exists but does NOT rebuild — call {@link refresh} to bring it to the chain (taking
   * what a file already holds when {@link CacheOptions.persist} is set), or {@link rebuild}
   * to replay it whole. An in-memory cache is empty until then.
   */
  static open(chainRoot: string, options: CacheOptions = {}): ProjectionCache {
    const layout: ChainLayout = { root: chainRoot };
    const upcasters = options.upcasters ?? catalogUpcasters();
    // A tree nobody has written to has nothing to keep, and a read must not be what creates its
    // directories: persisting waits for the first tail.
    const keeps = options.persist === true && listTails(layout).length > 0;
    const path = options.dbPath ?? (keeps ? projectionCachePath(layout) : IN_MEMORY);
    if (path === IN_MEMORY) {
      return new ProjectionCache(openMemory(), layout, upcasters, false);
    }
    // A named path is the caller's and fails loudly; the one this class chose is a cache and
    // gives way to memory — see {@link CacheOptions.persist}.
    if (options.dbPath !== undefined) {
      const db = openDatabase(path);
      ensureSchema(db);
      return new ProjectionCache(db, layout, upcasters, true);
    }
    try {
      const db = openDatabase(path);
      try {
        ensureSchema(db);
      } catch (error) {
        // A file whose tables this code cannot create over is a file of another shape: it is
        // a cache, so it is dropped and made again rather than reported.
        if (!isSqliteFailure(error)) throw error;
        dropProjections(db);
        ensureSchema(db);
      }
      return new ProjectionCache(db, layout, upcasters, true);
    } catch {
      return new ProjectionCache(openMemory(), layout, upcasters, false);
    }
  }

  /** Drops the cache and replays it from the chain. Safe to call any time. */
  rebuild(): void {
    this.guarded(() => this.replay());
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
   *   - A chain that changed in a way no suffix describes — a tail removed, a tail cut, a
   *     fact arriving stamped before something already covered — is not a break at all and
   *     answers as this cache already stood.
   *
   * IT NAMES THE BREAK OF EVERY BROKEN TAIL AMONG THE ARRIVALS, one per tail, as a full
   * replay does. It named the first break of the first broken tail, which a record whose two
   * tails both broke after the last reading answered with one of them; the remaining tails
   * are read only once one has broken, so a chain that chains costs what it cost
   * (`order.test.ts` holds both halves).
   *
   * It leaves this cache exactly as it found it: the tables and the frontier are
   * untouched, so the next {@link refresh} does the same work it would have done.
   */
  linkBreaksAsOfNow(): readonly LinkBreak[] {
    this.agree();
    if (this.frontier === undefined) return this.breaks;
    const arrived = chainArrivals(this.layout, this.upcasters, this.frontier);
    if (arrived.suffix || arrived.why !== 'AN_ARRIVAL_DOES_NOT_CHAIN') return this.breaks;
    // One break per tail, which is what a full reading reports: a tail this cache already
    // knows is broken does not gain a second line for a later break on the same tail.
    const knownTails = new Set(this.breaks.map((known) => known.tail));
    const fresh = arrived.broken.filter((broke) => !knownTails.has(broke.tail));
    return fresh.length === 0 ? this.breaks : [...this.breaks, ...fresh];
  }

  /**
   * The keys the record counts for `anchor` in this tree AS THE CHAIN IS NOW — the answer a
   * replay gives, and it brings nothing forward.
   *
   * It is the question every write asks before it appends (`ensureFounded`, in the write
   * operations): does the identity this checkout recorded still count its key? A replay answers it
   * at a price linear in the record, and a session asks it on every write, so the session asks
   * HERE: the membership facts this cache holds are what a replay would have read of the record,
   * and what arrived since is read the way {@link linkBreaksAsOfNow} reads it — one `readdir` per
   * tail and the entries past each boundary — and folded behind them by the roster's own fold
   * (`rosterIn`, the one `rosterOf` runs over a replay). The arrivals are taken only as a SUFFIX,
   * which is the merge's own comparison: where they are not one (a tail gone or cut, a fact
   * stamped before something already covered, a link that does not follow), the facts in hand are
   * no longer a prefix of the record's, and this replays the record whole — without rebuilding the
   * cache, which it leaves exactly as it found it.
   *
   * NOT the entity tables. Reading a projection would be reading what the last catch-up knew, and
   * a write gated on that is the stale cache this module is careful never to be.
   */
  rosterAsOfNow(anchor: string): Set<string> {
    const tree = this.layout.root;
    this.agree();
    if (this.frontier === undefined) return rosterOf({ tree, upcasters: this.upcasters }, anchor);
    const arrived = chainArrivals(this.layout, this.upcasters, this.frontier);
    if (!arrived.suffix) return rosterOf({ tree, upcasters: this.upcasters }, anchor);
    return rosterIn([...readMembership(this.db), ...arrived.events], tree, anchor);
  }

  /**
   * Brings the cache into agreement with the chain, doing the least work that is
   * sound — and it is the call a reader wants, not {@link rebuild}.
   *
   * A chain that only GREW since the last replay is brought forward from what
   * arrived: the arrivals are read (their own entries, not the chain), folded from the
   * accumulators the tables hold, and written into the rows they touch. A chain that
   * changed any other way — a tail pruned, a tail gone, a fact arriving stamped before
   * something already covered — cannot be described as a suffix, and this replays the whole
   * thing. So does a file that was built by other code, or whose sealed segments are not the
   * ones it saw ({@link CacheOptions.persist}).
   *
   * It is not a cheaper rebuild, it is the same result by a shorter route: the
   * tables it leaves behind are the ones a full replay would have written, which is asserted
   * for one event of every kind in the catalog (`advance.test.ts`). Nothing here decides what
   * a projection CONTAINS.
   *
   * THE COST IS THE ARRIVALS' AND NOT THE RECORD'S. Measured at 10, 30 and 100 thousand
   * events with one arrival, the version that folded the whole order again cost 0.056, 0.17
   * and 0.65 s; this one is flat (`measurements/the-record-at-scale/`).
   */
  refresh(): void {
    this.guarded(() => {
      // A file another process advanced while this one waited is not a file to advance over a
      // stale picture of: the arrivals are read against the frontier the FILE carries, and if
      // it moves between the reading and the write, the reading is done again.
      for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
        this.agree();
        if (this.frontier === undefined) {
          this.replay();
          return;
        }
        const arrived = chainArrivals(this.layout, this.upcasters, this.frontier);
        if (!arrived.suffix) {
          this.replay();
          return;
        }
        if (arrived.events.length === 0) return;
        const from = this.frontier.events;
        const expected = this.generation;
        const moved = this.db.transaction(() => {
          if (readGeneration(this.db) !== expected) return false;
          advance(this.db, arrived.events, from);
          this.store(arrived.frontier, this.breaks, expected + 1);
          return true;
        });
        if (moved.immediate()) {
          this.frontier = arrived.frontier;
          this.generation = expected + 1;
          return;
        }
      }
      // Another process kept winning the file: say so by replaying, which is correct whoever wins.
      this.replay();
    });
  }

  /** Replays the chain whole into the tables — the one place a rebuild is written. */
  private replay(): void {
    const replay = chainReplay(this.layout, this.upcasters);
    const write = this.db.transaction(() => {
      const generation = readGeneration(this.db) + 1;
      rebuild(this.db, replay.events);
      this.store(replay.frontier, replay.linkBreaks, generation);
      return generation;
    });
    this.generation = write.immediate();
    this.frontier = replay.frontier;
    this.breaks = replay.linkBreaks;
  }

  /** Writes what the cache says about itself, in the transaction that changed the tables. */
  private store(frontier: ChainFrontier, breaks: readonly LinkBreak[], generation: number): void {
    const meta: CacheMeta = {
      stamp: productStamp(),
      generation,
      frontier,
      breaks,
      sealed: this.persisted ? sealedFingerprints(frontier) : {},
    };
    writeMeta(this.db, meta);
  }

  /**
   * Takes the frontier the database carries when it is not the one this instance remembers —
   * the first time a file is opened, and every time another process has written since — and
   * leaves the frontier undefined when what the file carries is not a cache of THIS code over
   * THESE segments, which {@link refresh} reads as "replay".
   */
  private agree(): void {
    if (this.frontier !== undefined) {
      // A database only this process writes needs no asking, and a file other processes write
      // is asked one number before it is read whole.
      if (!this.persisted) return;
      if (this.guardedRead(() => readGeneration(this.db)) === this.generation) return;
    }
    const meta = this.guardedRead(() => readMeta(this.db));
    if (meta === undefined) {
      this.frontier = undefined;
      this.breaks = [];
      this.generation = -1;
      return;
    }
    if (meta.generation === this.generation && this.frontier !== undefined) return;
    this.generation = meta.generation;
    if (meta.stamp !== productStamp() || (this.persisted && !sealedSegmentsHold(meta.sealed))) {
      this.frontier = undefined;
      this.breaks = [];
      return;
    }
    this.frontier = meta.frontier;
    this.breaks = meta.breaks;
  }

  /**
   * Runs a step over the database, and if the DATABASE fails it — a file another process holds
   * past the wait, a corrupt one, a full disk — leaves the file and goes on in memory: the
   * cache is rebuilt there from the chain, and the answer is the same. A failure of the CHAIN
   * (a line that does not parse) is not the database's and goes up as it always did.
   */
  private guarded(step: () => void): void {
    try {
      step();
    } catch (error) {
      if (!this.persisted || !isSqliteFailure(error)) throw error;
      this.degrade();
      step();
    }
  }

  private guardedRead<T>(read: () => T): T | undefined {
    try {
      return read();
    } catch (error) {
      if (!this.persisted || !isSqliteFailure(error)) throw error;
      this.degrade();
      return undefined;
    }
  }

  /** Gives up the file for this process: a fresh in-memory database, known to hold nothing. */
  private degrade(): void {
    try {
      this.db.close();
    } catch {
      // A handle that will not close is one nothing more is asked of.
    }
    this.db = openMemory();
    this.persisted = false;
    this.frontier = undefined;
    this.breaks = [];
    this.generation = -1;
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

  /** How many decisions are projected. */
  countDecisions(): number {
    return countDecisions(this.db);
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
   * @mnema/context), which serves the label into a committed document and so has
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
   * The records of this tree that share any of `query.words`, best first — the index's
   * answer to "what here is near these", with the same line per hit a search serves.
   */
  searchPertinent(query: PertinenceQuery): SearchResult {
    return searchPertinent(this.db, query);
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
   * Every identity founded in this tree after others already were, in record order — the
   * reading `identitiesFoundedBeside` gives, asked of the membership facts this cache keeps
   * (`membership_facts`: the foundings, enrolments and revocations of the record, in its order).
   *
   * THIS SAID IT WAS ASKED OF "THE ORDER THIS CACHE ALREADY HOLDS", a walk over events in
   * memory at 2.8 µs over 602 events and 16-19 µs over 6,002. The premise was that the cache
   * holds the order, and it does not any more: holding it was 1.0 GB at 100 thousand events and
   * the whole cost of bringing a cache forward (see {@link frontier}). What the reading needs
   * of the order is the foundings, and the cache keeps those — a handful of rows in any record
   * — so the answer is the same walk over them. The figures above were of the walk over the
   * order and are not claimed of this one.
   *
   * It answers as the cache stands: a reader that wants the chain as it is now brings the
   * cache forward first, as every read of it does.
   */
  foundedBeside(): FoundedBeside[] {
    return identitiesFoundedBeside(readMembership(this.db));
  }

  /**
   * The anchors this tree enrolls as CHECKERS — machines whose key signs check results and
   * nothing else — in record order, once each. Read off the membership facts this cache keeps;
   * whether each enrolment holds is `verify`'s to prove (FORMAT.md section 6.2).
   */
  checkers(): string[] {
    const anchors = new Set<string>();
    for (const event of readMembership(this.db)) {
      if (event.kind === 'checker.enrolled') anchors.add(event.subject);
    }
    return [...anchors];
  }

  /**
   * The checkers this tree RETIRES, by the checker's anchor, each with the identity whose
   * `checker.retired` came first in record order. Read off the membership facts this cache
   * keeps; whether each retirement took effect is `verify`'s to prove (FORMAT.md section 6.2).
   */
  retiredCheckers(): Map<string, string> {
    const retired = new Map<string, string>();
    for (const event of readMembership(this.db)) {
      if (event.kind === 'checker.retired' && !retired.has(event.subject)) {
        retired.set(event.subject, event.who);
      }
    }
    return retired;
  }

  /**
   * Every decision, skill and task of this tree that two machines moved out of one state
   * without seeing each other (`divergentMoves`) — asked of the rows this cache keeps for the
   * entities that have one, which an advance maintains one entity at a time. The same answer
   * read off the disk is a second replay, and over the order it was a walk the cache no longer
   * holds the order for (see {@link foundedBeside}).
   *
   * It answers as the cache stands, like every read of it.
   */
  divergentMoves(): DivergentMove[] {
    return readDivergences(this.db);
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
