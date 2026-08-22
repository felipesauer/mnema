/**
 * Bringing a cache forward is the SAME cache, and that is proved against a full
 * replay for one event of every kind the catalog holds.
 *
 * `advance` writes only the tables the arrivals feed (`fed-by.ts`) and appends to
 * the reference index rather than replacing it. Both are decisions about WORK, and
 * neither may be a decision about content — so what every case here asserts is the
 * strongest form available: after the arrival, the advanced database and a database
 * replayed from the same chain hold the SAME ROWS in every projection table.
 *
 * WHY IT IS DRIVEN BY KIND, and why that is not decoration. `FED_BY_KIND` is a hand
 * written table. Its type forces every kind to have a row and every value to be a
 * real table, and no type can force a row to name the tables the folds ACTUALLY
 * read — a row that under-claims does not fail to compile, it serves a stale table.
 * That is silent corruption rather than slowness, and it is the one failure this
 * whole direction could produce. So: one event of every kind, and a row that forgot
 * a table goes red on the table it forgot.
 *
 * The drivers are their own table rather than the one in `content/every-field.test.ts`,
 * because the obligation is different: that one poisons every text field to prove the
 * door runs, this one appends one ordinary fact to a record that already exists.
 *
 * THIS PARAGRAPH USED TO SAY THAT BOTH TABLES ARE "total over {@link EventKind} by
 * type, so a kind added to the catalog fails to compile in each until it is driven",
 * AND IT WAS FALSE OF BOTH. A mapped type declared in a `.test.ts` is checked by
 * nothing: `tsc -b` excludes tests and vitest strips types without checking them. It
 * was measured — a kind added to the catalog with no row in either table left the
 * build's complaints in `src` alone, and the two tables silent. The one next door
 * survived it anyway, because it asserts its keys against the catalog at RUN time; this
 * one iterated `Object.keys(ARRIVALS)`, so an undriven kind was not failed, it was
 * SKIPPED — 32 cases passed and the new kind got no advance-versus-replay proof at all.
 * The table below is now held against the catalog at run time, by the case that opens
 * the suite.
 *
 * THREE KINDS CANNOT ARRIVE ALONE, and the cases say so rather than pretending
 * otherwise: `createTask`, `recordDecision` and `createSkill` each write a birth PAIR
 * (the `*.created`/`*.recorded` and the birth `*.transitioned`), so driving one of
 * those kinds puts two on the chain. The two rows involved are identical in
 * `FED_BY_KIND` — the same entity table and the same index — so neither can mask the
 * other; what the case proves for the pair it proves for each. Every other kind
 * arrives as exactly one event, which each case asserts.
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  type EventKind,
  LATEST_VERSION,
  openChainForWriting,
  tailDir,
  type UpcasterRegistry,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema, PROJECTION_TABLES } from '../db/schema.js';
import { IN_MEMORY, openDatabase, type SqliteDatabase } from '../db/sqlite.js';
import {
  captureMemory,
  linkKnowledge,
  recordHandoff,
  recordObservation,
} from '../knowledge/operations.js';
import {
  recordChannelAsked,
  recordChannelServed,
  switchChannel,
} from '../workflow/channel-operations.js';
import { acceptDecision, recordDecision } from '../workflow/decision-operations.js';
import { enrollKey, foundIdentity, revokeKey } from '../workflow/identity-operations.js';
import { createTask, transitionTask, type WriteContext } from '../workflow/operations.js';
import { authorizeTailPrune } from '../workflow/prune-operations.js';
import { endRun, startRun } from '../workflow/session-operations.js';
import { createSkill, recordConsultation, reviewSkill } from '../workflow/skill-operations.js';
import { ProjectionCache } from './cache.js';
import { tablesFedBy } from './fed-by.js';
import { chainArrivals, chainReplay } from './order.js';
import { advance, rebuild } from './rebuild.js';

const upcasters: UpcasterRegistry = catalogUpcasters();

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-advance-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A write context over the sandbox chain, signing with a key rooted in it. */
function open(options: { maxSegmentBytes?: number } = {}): WriteContext {
  return {
    writer: openChainForWriting(root, { keyRoot: root, ...options }),
    layout: { root },
    upcasters,
  };
}

/**
 * A record with something in every table, written BEFORE the frontier is taken —
 * so what each case then drives is the only arrival, and the tables it must and
 * must not disturb are already full.
 */
function aRecordAlreadyHere(ctx: WriteContext): { task: string; decision: string; skill: string } {
  const task = landed(createTask(ctx, { title: 'a task that was already here' }));
  const decision = landed(
    recordDecision(ctx, { title: 'a decision already here', rationale: 'because' }),
  );
  const skill = landed(createSkill(ctx, { name: 'a pattern already here', body: 'the steps' }));
  landed(captureMemory(ctx, { content: 'a memory already here' }));
  landed(recordObservation(ctx, { about: task.id, topic: 'already', text: 'an observation' }));
  landed(recordHandoff(ctx, { task: task.id, fromAgent: 'one', toAgent: 'two' }));
  landed(linkKnowledge(ctx, { subject: decision.id, target: task.id, rel: 'informs' }));
  landed(switchChannel(ctx, { channel: 'a-channel-already-here', on: false }));
  const run = landed(startRun(ctx, { agent: 'an-agent', goal: 'to have a run here' }));
  landed(recordConsultation(ctx, { skill: skill.id, run: run.id }));
  ctx.writer.checkpoint();
  return { task: task.id, decision: decision.id, skill: skill.id };
}

/** Unwraps a write result, failing the case rather than the assertion below it. */
function landed<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/**
 * What each kind's arrival needs in place first, and the arrival itself. The setup
 * runs BEFORE the frontier, so a kind whose write needs an entity to move does not
 * smuggle that entity's birth into the arrival under test.
 */
interface Arrival {
  readonly setup?: (ctx: WriteContext, already: ReturnType<typeof aRecordAlreadyHere>) => unknown;
  readonly emit: (ctx: WriteContext, prepared: unknown) => void;
  /**
   * Set for the ONE kind that cannot arrive after anything: a founding is the first
   * write a tree ever takes, and every other driver's setup has already performed it.
   * So its case takes the frontier over an EMPTY chain — which is the honest shape of
   * that arrival, not a concession — and there is nothing already here for it to
   * disturb.
   */
  readonly overAnEmptyChain?: true;
}

const ARRIVALS: { readonly [K in EventKind]: Arrival } = {
  'run.started': { emit: (ctx) => landed(startRun(ctx, { agent: 'a-fresh-agent' })) },
  'run.ended': {
    setup: (ctx) => landed(startRun(ctx, { agent: 'an-agent-that-will-stop' })).id,
    emit: (ctx, run) => landed(endRun(ctx, { run: run as string, outcome: 'done' })),
  },
  // The birth PAIR — see the note at the top of this file.
  'task.created': { emit: (ctx) => landed(createTask(ctx, { title: 'a task that arrived' })) },
  'task.transitioned': {
    setup: (ctx) => landed(createTask(ctx, { title: 'a task that will move' })).id,
    emit: (ctx, task) => landed(transitionTask(ctx, { id: task as string, action: 'submit' })),
  },
  'decision.recorded': {
    emit: (ctx) =>
      landed(recordDecision(ctx, { title: 'a decision that arrived', rationale: 'why' })),
  },
  'decision.transitioned': {
    setup: (ctx) =>
      landed(recordDecision(ctx, { title: 'a decision that will move', rationale: 'why' })).id,
    emit: (ctx, decision) =>
      landed(acceptDecision(ctx, { id: decision as string, fields: { note: 'accepted' } })),
  },
  // Founding happens once per tree and every other driver's setup has already done
  // it, so this one arrives over an empty chain.
  'identity.founded': { emit: (ctx) => landed(foundIdentity(ctx)), overAnEmptyChain: true },
  'key.enrolled': {
    emit: (ctx) => landed(enrollKey(ctx, { newFp: 'a'.repeat(64), reverseSig: 'b'.repeat(128) })),
  },
  'key.revoked': {
    emit: (ctx) => landed(revokeKey(ctx, { revokedFp: 'f'.repeat(64), reason: 'retired' })),
  },
  'memory.captured': {
    emit: (ctx) => landed(captureMemory(ctx, { content: 'a memory that arrived' })),
  },
  'observation.recorded': {
    emit: (ctx, prepared) =>
      landed(
        recordObservation(ctx, {
          about: (prepared as { task: string }).task,
          topic: 'arrived',
          text: 'an observation that arrived',
        }),
      ),
    setup: (_ctx, already) => already,
  },
  'handoff.recorded': {
    setup: (_ctx, already) => already.task,
    emit: (ctx, task) =>
      landed(recordHandoff(ctx, { task: task as string, fromAgent: 'two', toAgent: 'three' })),
  },
  'knowledge.linked': {
    setup: (_ctx, already) => already,
    emit: (ctx, prepared) => {
      const { task, skill } = prepared as { task: string; skill: string };
      landed(linkKnowledge(ctx, { subject: skill, target: task, rel: 'informs' }));
    },
  },
  'skill.created': {
    emit: (ctx) => landed(createSkill(ctx, { name: 'a pattern that arrived', body: 'the steps' })),
  },
  'skill.transitioned': {
    setup: (ctx) => landed(createSkill(ctx, { name: 'a pattern to review', body: 'steps' })).id,
    emit: (ctx, skill) =>
      landed(reviewSkill(ctx, { id: skill as string, fields: { note: 'reviewed' } })),
  },
  'skill.consulted': {
    setup: (_ctx, already) => already.skill,
    emit: (ctx, skill) => landed(recordConsultation(ctx, { skill: skill as string })),
  },
  // A waiver may not name the tail it is written to, so a second tail has to exist
  // before the frontier is taken.
  'tail.pruned': {
    setup: (ctx) => aSecondTailIn(ctx.layout.root),
    emit: (ctx, tail) =>
      landed(authorizeTailPrune(ctx, { tail: tail as string, reason: 'it served its purpose' })),
  },
  'channel.switched': {
    emit: (ctx) => landed(switchChannel(ctx, { channel: 'a-channel-that-arrived', on: false })),
  },
  'channel.served': {
    emit: (ctx) => landed(recordChannelServed(ctx, { channel: 'a-channel-that-served' })),
  },
  'channel.asked': {
    emit: (ctx) =>
      landed(
        recordChannelAsked(ctx, {
          channel: 'a-channel-that-asked',
          rule: '0198f0a1-2b3c-7d4e-8f90-a1b2c3d4e5f6',
          path: 'packages/core/src/projections/rebuild.ts',
        }),
      ),
  },
};

/** Puts a SECOND tail in the tree — another installation's key writing into it. */
function aSecondTailIn(chainRoot: string): string {
  const otherKeys = mkdtempSync(join(tmpdir(), 'mnema-advance-other-'));
  try {
    const other: WriteContext = {
      writer: openChainForWriting(chainRoot, { keyRoot: otherKeys }),
      layout: { root: chainRoot },
      upcasters,
    };
    landed(captureMemory(other, { content: 'written from the other machine' }));
    other.writer.checkpoint();
    return other.writer.tailId;
  } finally {
    rmSync(otherKeys, { recursive: true, force: true });
  }
}

/**
 * Every row of every projection table, as comparable values. Sorted, because SQL row
 * order is not a property of a projection — the ORDER a projection carries is in the
 * `ord` column, which is inside the rows being compared.
 */
function dump(db: SqliteDatabase): Record<string, string[]> {
  const tables: Record<string, string[]> = {};
  for (const table of PROJECTION_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
    tables[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return tables;
}

/** A database with the schema and nothing in it. */
function emptyDb(): SqliteDatabase {
  const db = openDatabase(IN_MEMORY);
  ensureSchema(db);
  return db;
}

describe('an arrival brings the cache to exactly where a replay would have put it', () => {
  it('drives every kind the catalog holds, and no kind it does not', () => {
    // THE LOOP BELOW WALKS THE TABLE, so a kind missing from it is skipped rather
    // than failed, and the type that was supposed to prevent that is inert in a test
    // file. This is the check that makes the table total: it is asked of the CATALOG,
    // which is the only list that cannot fall behind the catalog.
    expect(Object.keys(ARRIVALS).sort()).toEqual(Object.keys(LATEST_VERSION).sort());
  });

  for (const kind of Object.keys(ARRIVALS) as EventKind[]) {
    it(`${kind} — advanced tables equal replayed tables`, () => {
      const ctx = open();
      const arrival = ARRIVALS[kind];
      const already =
        arrival.overAnEmptyChain === true
          ? { task: '', decision: '', skill: '' }
          : aRecordAlreadyHere(ctx);
      const prepared = arrival.setup?.(ctx, already);
      ctx.writer.checkpoint();

      // The frontier is taken AFTER the setup, so the arrival under test is the only
      // thing beyond it.
      const before = chainReplay(ctx.layout, upcasters);
      const advanced = emptyDb();
      rebuild(advanced, before.events);

      arrival.emit(ctx, prepared);
      ctx.writer.checkpoint();

      const arrived = chainArrivals(ctx.layout, upcasters, before.frontier);
      if (!arrived.suffix) throw new Error(`the arrival was not a suffix: ${arrived.why}`);
      expect(arrived.events.length, 'the driver put nothing on the chain').toBeGreaterThan(0);
      expect(
        arrived.events.map((event) => event.kind),
        'the arrival holds the kind under test',
      ).toContain(kind);

      const order = [...before.events, ...arrived.events];
      const arrivedKinds = arrived.events.map((event) => event.kind);
      advance(advanced, order, arrived.events, before.events.length, tablesFedBy(arrivedKinds));

      // AND AGAIN with THIS KIND'S ROW ALONE, which is what closes the masking the
      // birth pairs would otherwise create. A pair puts two kinds on the chain, so the
      // union of their rows can carry a table the row under test forgot — measured: a
      // mutation that deleted the full-text index from `task.created` left this case
      // green, because `task.transitioned` arrived beside it still naming it. Every
      // arrival a driver here produces holds kinds that SHARE a row, so restricting to
      // one of them asks for exactly the same tables and no fewer.
      const byThisKindAlone = emptyDb();
      rebuild(byThisKindAlone, before.events);
      advance(byThisKindAlone, order, arrived.events, before.events.length, tablesFedBy([kind]));

      const replayed = emptyDb();
      rebuild(replayed, chainReplay(ctx.layout, upcasters).events);

      const expected = dump(replayed);
      expect(dump(advanced), 'the union of the arrival’s rows').toEqual(expected);
      expect(dump(byThisKindAlone), `the row for ${kind} alone`).toEqual(expected);
      advanced.close();
      byThisKindAlone.close();
      replayed.close();
    });
  }
});

describe('the tables an arrival does NOT feed are left alone', () => {
  it('a channel fact rewrites the run table and the index, and nothing else', () => {
    // The claim `fed-by.ts` makes about its two universal entries, from the other
    // side: what a channel fact feeds is exactly `refs` and `runs`. If either were
    // missing from the row, the case above would go red; if a third table were
    // listed, this one says so.
    expect([...tablesFedBy(['channel.asked'])].sort()).toEqual(['refs', 'runs']);
    expect([...tablesFedBy(['channel.served'])].sort()).toEqual(['refs', 'runs']);
    // And the union over a run of arrivals is the union, not the last one.
    expect([...tablesFedBy(['channel.asked', 'task.created'])].sort()).toEqual([
      'record_search',
      'refs',
      'runs',
      'tasks',
    ]);
  });
});

describe('a chain that changed some other way is replayed whole', () => {
  /**
   * The cache against a SECOND cache freshly replayed from the same chain, through
   * every read that answers from a different table. The case above compares the
   * tables themselves; this compares what a caller would get, which is what a
   * fallback has to leave right.
   */
  function agreesWithAFullReplay(cache: ProjectionCache): void {
    const replayed = ProjectionCache.open(root, { upcasters });
    try {
      replayed.rebuild();
      expect(cache.listTasks()).toEqual(replayed.listTasks());
      expect(cache.listDecisions()).toEqual(replayed.listDecisions());
      expect(cache.listMemories()).toEqual(replayed.listMemories());
      expect(cache.listSkills()).toEqual(replayed.listSkills());
      expect(cache.listRuns()).toEqual(replayed.listRuns());
      expect(cache.channelSwitches()).toEqual(replayed.channelSwitches());
      expect(cache.search({})).toEqual(replayed.search({}));
      expect(cache.authorship({})).toEqual(replayed.authorship({}));
    } finally {
      replayed.close();
    }
  }

  it('a tail that is gone: the cache replays and reports what is there', () => {
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    expect(cache.listTasks()).toHaveLength(1);

    // What the product's own `tail prune` tells a person to do, and refuses to do
    // itself: the files are removed by hand.
    rmSync(join(root, 'tails'), { recursive: true, force: true });

    cache.refresh();
    expect(cache.listTasks()).toHaveLength(0);
    agreesWithAFullReplay(cache);
    cache.close();
  });

  it('a tail cut below what was replayed: the cache replays the rest', () => {
    // Small segments so the tail has more than one, and the first can go.
    const ctx = open({ maxSegmentBytes: 2048 });
    aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    const before = cache.listTasks().length;
    expect(before).toBe(1);

    const tail = ctx.writer.tailId;
    const dir = tailDir({ root }, tail);
    const segments = readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
    expect(segments.length, 'the tail needs more than one segment to be cut').toBeGreaterThan(1);
    rmSync(join(dir, segments[0] as string));

    // Nothing throws, and what is served is what the shortened chain says — which is
    // the whole point of falling back rather than appending onto a stale order.
    cache.refresh();
    agreesWithAFullReplay(cache);
    cache.close();
  });

  it('a TAIL arriving with older facts: the cache replays', () => {
    // The pulled clone, which is the case this refusal exists for: a colleague's tail
    // shows up holding facts stamped before everything already covered, so the merge
    // would interleave them into the middle of the order and every position after them
    // would shift. Nothing here can be appended, and the cache says so by replaying.
    //
    // It replaced a case that drove the same clock through the session's OWN tail and
    // was measured VACUOUS: removing this refusal left the whole suite green, because
    // within one tail `seq` is the order and there is nothing for it to refuse.
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    expect(cache.listTasks()).toHaveLength(1);

    const before = chainReplay(ctx.layout, upcasters);
    const otherKeys = mkdtempSync(join(tmpdir(), 'mnema-advance-older-'));
    try {
      const colleague: WriteContext = {
        writer: openChainForWriting(root, { keyRoot: otherKeys }),
        layout: { root },
        upcasters,
        clock: () => '2000-01-01T00:00:00.000Z',
      };
      landed(captureMemory(colleague, { content: 'written long before, on another machine' }));
      colleague.writer.checkpoint();

      expect(chainArrivals(ctx.layout, upcasters, before.frontier)).toEqual({
        suffix: false,
        why: 'AN_ARRIVAL_IS_NOT_LATER',
      });
      cache.refresh();
      expect(cache.listMemories()).toHaveLength(2);
      agreesWithAFullReplay(cache);
    } finally {
      rmSync(otherKeys, { recursive: true, force: true });
    }
    cache.close();
  });

  it('a clock that stepped back INSIDE one tail is still a suffix, and still right', () => {
    // The other half, and it is not a fallback: within a tail `seq` is the order and
    // the hash chain proves it, so an event stamped before its predecessor still comes
    // after it. There is nothing to refuse, and the cache brings itself forward — what
    // this pins is that the ROWS are the ones a replay would have written, which is the
    // only thing at stake.
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();

    const before = chainReplay(ctx.layout, upcasters);
    const stepped: WriteContext = { ...ctx, clock: () => '2000-01-01T00:00:00.000Z' };
    landed(createTask(stepped, { title: 'written by a clock that stepped back' }));
    stepped.writer.checkpoint();

    expect(chainArrivals(ctx.layout, upcasters, before.frontier)).toMatchObject({ suffix: true });
    cache.refresh();
    expect(cache.listTasks()).toHaveLength(2);
    agreesWithAFullReplay(cache);
    cache.close();
  });

  it('a chain that did not move at all is not touched', () => {
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    const before = chainReplay(ctx.layout, upcasters);
    const arrived = chainArrivals(ctx.layout, upcasters, before.frontier);
    expect(arrived).toMatchObject({ suffix: true });
    if (!arrived.suffix) return;
    expect(arrived.events).toHaveLength(0);
    expect(arrived.frontier).toEqual(before.frontier);
  });
});

describe('what `advance` refuses to be given', () => {
  it('arrivals that are not the tail of the order', () => {
    // A programming error rather than a state of the record, and the guard had NO case
    // until a mutation removed it and left the whole suite green. It earns one: the
    // failure it prevents is the reference index appending at a position that is not
    // where those events sit, which nothing downstream would notice.
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const replay = chainReplay(ctx.layout, upcasters);
    const db = emptyDb();
    try {
      rebuild(db, replay.events);
      expect(() =>
        advance(db, replay.events, replay.events.slice(-1), 0, tablesFedBy(['task.created'])),
      ).toThrow(RangeError);
    } finally {
      db.close();
    }
  });
});

describe('the suffix test is the merge’s own comparison, per tail', () => {
  it('two appends inside one millisecond are still a suffix', () => {
    // The case that decides whether the fast path is reachable at all. `at` has
    // millisecond resolution and a channel that fires on every edit appends far
    // faster than that, so a session ties with ITSELF constantly. Within one tail
    // `seq` is the order and the merge never compares two of its events, so a tie
    // there is not a reordering — and a test that refused it would replay the chain
    // on every append, which is what the first version of this did.
    const ctx = open();
    const frozen: WriteContext = { ...ctx, clock: () => '2026-08-19T12:00:00.000Z' };
    landed(createTask(frozen, { title: 'the first, at that instant' }));
    frozen.writer.checkpoint();

    const before = chainReplay(ctx.layout, upcasters);
    landed(createTask(frozen, { title: 'the second, at the SAME instant' }));
    frozen.writer.checkpoint();

    const arrived = chainArrivals(ctx.layout, upcasters, before.frontier);
    expect(arrived).toMatchObject({ suffix: true });
    if (!arrived.suffix) return;
    expect(arrived.events).toHaveLength(2);
  });

  it('an arrival that ties with a later-sorting tail is not a suffix', () => {
    // The tie the merge DOES break, and the reason the test cannot simply ignore
    // instants: across tails the order is `(at, tail)`, so an arrival stamped at the
    // same instant as a covered event of a tail that sorts after it would be placed
    // BEFORE that event — an interleave, not a suffix.
    const instant = '2026-08-19T12:00:00.000Z';
    const first = open();
    const firstFrozen: WriteContext = { ...first, clock: () => instant };
    landed(captureMemory(firstFrozen, { content: 'from one machine' }));
    firstFrozen.writer.checkpoint();

    const otherKeys = mkdtempSync(join(tmpdir(), 'mnema-advance-tie-'));
    try {
      const second: WriteContext = {
        writer: openChainForWriting(root, { keyRoot: otherKeys }),
        layout: { root },
        upcasters,
        clock: () => instant,
      };
      landed(captureMemory(second, { content: 'from the other machine' }));
      second.writer.checkpoint();

      // Whichever tail sorts EARLIER is the one whose arrival would be placed before
      // the other's covered event. The ids are key fingerprints, so which is which is
      // not this test's to choose — it reads them and drives the one that must fail.
      const earlier = first.writer.tailId < second.writer.tailId ? firstFrozen : second;
      const before = chainReplay({ root }, upcasters);
      landed(captureMemory(earlier, { content: 'tying with a tail that sorts after me' }));
      earlier.writer.checkpoint();

      expect(chainArrivals({ root }, upcasters, before.frontier)).toEqual({
        suffix: false,
        why: 'AN_ARRIVAL_IS_NOT_LATER',
      });
    } finally {
      rmSync(otherKeys, { recursive: true, force: true });
    }
  });
});

describe('a write that changes something is still seen by the read after it', () => {
  it('a task created after the frontier is in the cache the next read gets', () => {
    // The property that must not be traded for the speed: the read after a write
    // sees the write. Proved by CASE rather than by a stopwatch — the timing says
    // nothing about whether the answer was right.
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    expect(cache.listTasks()).toHaveLength(1);

    const fresh = landed(createTask(ctx, { title: 'written between two reads' }));
    ctx.writer.checkpoint();

    cache.refresh();
    expect(cache.listTasks().map((task) => task.title)).toEqual([
      'a task that was already here',
      'written between two reads',
    ]);
    expect(cache.getTask(fresh.id)).not.toBeNull();

    // …and the state a MOVE writes, which is the other half: a transition rewrites a
    // row rather than adding one, so a table left alone would report the old state.
    landed(transitionTask(ctx, { id: fresh.id, action: 'submit' }));
    ctx.writer.checkpoint();
    cache.refresh();
    expect(cache.getTask(fresh.id)?.state).toBe('READY');
    cache.close();
  });

  it('the reference index an arrival appends to is the one a replay would have built', () => {
    // The one materialization brought forward by APPENDING. Its rows carry `ord`, the
    // event's position in the order, so an append that got the base wrong would be a
    // history pointing at the wrong facts — and it would not throw.
    const ctx = open();
    const already = aRecordAlreadyHere(ctx);
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();

    landed(recordObservation(ctx, { about: already.task, topic: 'after', text: 'appended' }));
    ctx.writer.checkpoint();
    cache.refresh();

    const replayed = ProjectionCache.open(root, { upcasters });
    replayed.rebuild();
    expect(cache.references(already.task)).toEqual(replayed.references(already.task));
    expect(cache.authorship({})).toEqual(replayed.authorship({}));
    cache.close();
    replayed.close();
  });
});

describe('a cache refreshed again and again equals one replayed once', () => {
  it('keeps the frontier moving, so the same arrival is never applied twice', () => {
    // THE CASES ABOVE CALL `advance` DIRECTLY, which is what leaves this uncovered:
    // they hand it the order and the position themselves, so nothing exercises the
    // bookkeeping `ProjectionCache.refresh` does BETWEEN two arrivals — the frontier it
    // carries forward and the order it keeps. Measured: deleting `this.frontier =
    // arrived.frontier` left the whole suite green, and the reference index — the one
    // table that is APPENDED rather than rebuilt — went from one row per appearance to
    // two and then four, because every refresh re-applied what the last one had already
    // written. Silent corruption of the index three audits read.
    //
    // So this drives the CACHE, not the function, and more than once. The assertion is
    // the file's own: what it holds equals what a replay of the same chain holds.
    const ctx = open();
    aRecordAlreadyHere(ctx);
    const dbPath = join(root, 'warm.db');
    const cache = ProjectionCache.open(root, { dbPath });
    cache.rebuild();

    // Three arrivals, refreshed one at a time. `channel.served` is the shape the charge
    // repeats hundreds of times in one session, and it is the shape that feeds `refs`.
    const arrivals = [
      () => landed(switchChannel(ctx, { channel: 'a-channel', on: false })),
      () => landed(startRun(ctx, { agent: 'an-agent', goal: 'a second run' })),
      () => landed(captureMemory(ctx, { content: 'something after the frontier' })),
    ];
    for (const emit of arrivals) {
      emit();
      ctx.writer.checkpoint();
      cache.refresh();
    }
    cache.close();

    const replayed = emptyDb();
    rebuild(replayed, chainReplay(ctx.layout, upcasters).events);
    const warm = openDatabase(dbPath);
    expect(dump(warm), 'three refreshes equal one replay').toEqual(dump(replayed));
    warm.close();
    replayed.close();
  });
});
