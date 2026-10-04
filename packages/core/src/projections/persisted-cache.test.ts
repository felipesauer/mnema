/**
 * A projection kept on disk is a CACHE: it may answer faster than a replay, and it may never
 * answer differently, and deleting it must change nothing but the time.
 *
 * Each case states one property of that sentence and is read off the real thing — a file in a
 * tree, opened by a second cache the way a second process opens it — rather than off the
 * functions that make it:
 *
 *   - IT IS NOT BUILT AGAIN. A row planted in the file that no replay would write survives the
 *     next open, which is the only way to tell "took what arrived" from "built it all again and
 *     got the same answers";
 *   - WHAT IT HOLDS AFTER AN ARRIVAL IS WHAT A REPLAY HOLDS, in every table;
 *   - DELETING IT CHANGES NO ANSWER, over every read the cache serves;
 *   - IT IS REPLACED, not trusted, whenever it cannot be vouched for: code that wrote it is not
 *     this code, a tail was removed, cut or restored to a shorter file, a sealed segment is not the
 *     file it recorded, the file is garbage, the directory cannot be written;
 *   - A TREE NOBODY HAS WRITTEN TO KEEPS NOTHING, so a read never founds a directory.
 */

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  decisionTransitioned,
  openChainForWriting,
  projectionCachePath,
  tailDir,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema, PROJECTION_TABLES } from '../db/schema.js';
import { IN_MEMORY, openDatabase } from '../db/sqlite.js';
import { captureMemory, recordObservation, retractNote } from '../knowledge/operations.js';
import { switchChannel } from '../workflow/channel-operations.js';
import { acceptDecision, recordDecision } from '../workflow/decision-operations.js';
import { createTask, transitionTask, type WriteContext } from '../workflow/operations.js';
import { endRun, startRun } from '../workflow/session-operations.js';
import { createSkill } from '../workflow/skill-operations.js';
import { ProjectionCache } from './cache.js';

const upcasters = catalogUpcasters();

let root: string;
let keys: string;
const open: ProjectionCache[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-persisted-'));
  keys = mkdtempSync(join(tmpdir(), 'mnema-persisted-keys-'));
  open.length = 0;
});

afterEach(() => {
  for (const cache of open) cache.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
});

function writing(options: { maxSegmentBytes?: number; keyRoot?: string } = {}): WriteContext {
  return {
    writer: openChainForWriting(root, {
      keyRoot: options.keyRoot ?? keys,
      ...(options.maxSegmentBytes !== undefined
        ? { maxSegmentBytes: options.maxSegmentBytes }
        : {}),
    }),
    layout: { root },
    upcasters,
  };
}

function landed<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** A record with something in most tables, so an answer that goes missing is noticed. */
function aRecord(ctx: WriteContext): { task: string; decision: string } {
  const task = landed(createTask(ctx, { title: 'a task that was already here' })).id;
  const decision = landed(
    recordDecision(ctx, { title: 'a decision already here', rationale: 'because' }),
  ).id;
  landed(createSkill(ctx, { name: 'a pattern already here', body: 'the steps' }));
  landed(captureMemory(ctx, { content: 'a memory already here' }));
  landed(recordObservation(ctx, { about: task, topic: 'already', text: 'an observation' }));
  landed(switchChannel(ctx, { channel: 'a-channel-already-here', on: false }));
  const run = landed(startRun(ctx, { agent: 'an-agent', goal: 'to have a run here' }));
  landed(endRun(ctx, { run: run.id, which: 'an-agent', outcome: 'done' }));
  ctx.writer.checkpoint();
  return { task, decision };
}

function persisted(): ProjectionCache {
  const cache = ProjectionCache.open(root, { upcasters, persist: true });
  open.push(cache);
  return cache;
}

function replayed(): ProjectionCache {
  const cache = ProjectionCache.open(root, { upcasters });
  open.push(cache);
  cache.rebuild();
  return cache;
}

/** Every read the cache serves, so "the same answers" is one comparison and not a hope. */
function answersOf(cache: ProjectionCache): Record<string, unknown> {
  return {
    tasks: cache.listTasks(),
    decisions: cache.listDecisions(),
    memories: cache.listMemories(),
    skills: cache.listSkills(),
    runs: cache.listRuns(),
    switches: cache.channelSwitches(),
    search: cache.search({}),
    authorship: cache.authorship({}),
    authors: cache.authors(),
    founded: cache.foundedBeside(),
    divergent: cache.divergentMoves(),
    collisions: cache.adrCollisions(),
    breaks: cache.linkBreaks,
  };
}

/** Every row of every projection table of a database file, sorted — what a replay would hold. */
function rowsOf(path: string): Record<string, string[]> {
  const db = openDatabase(path);
  try {
    const tables: Record<string, string[]> = {};
    for (const table of PROJECTION_TABLES) {
      // The rowid a full-text row was given is where an index was built, not what it holds.
      const columns = table === 'search_rows' ? 'kind, id' : '*';
      const rows = db.prepare(`SELECT ${columns} FROM ${table}`).all() as unknown[];
      tables[table] = rows.map((row) => JSON.stringify(row)).sort();
    }
    return tables;
  } finally {
    db.close();
  }
}

/** The rows a replay writes into an in-memory database, for the same chain. */
function rowsOfAReplay(): Record<string, string[]> {
  const scratch = mkdtempSync(join(tmpdir(), 'mnema-persisted-replay-'));
  const memory = join(scratch, 'replay.db');
  const cache = ProjectionCache.open(root, { upcasters, dbPath: memory });
  cache.rebuild();
  cache.close();
  const rows = rowsOf(memory);
  rmSync(scratch, { recursive: true, force: true });
  return rows;
}

/** A row no replay of any chain writes: if it is still there, the cache was not built again. */
function plantAMarker(): void {
  const db = openDatabase(projectionCachePath({ root }));
  db.prepare(
    "INSERT INTO memories (id, content, who, captured_at) VALUES ('a-marker', 'not from the chain', 'nobody', '2000-01-01T00:00:00.000Z')",
  ).run();
  db.close();
}

function theMarkerSurvived(cache: ProjectionCache): boolean {
  return cache.listMemories().some((memory) => memory.id === 'a-marker');
}

describe('a cache kept in the tree is brought forward, not built again', () => {
  it('the next open takes what arrived and leaves the rows it did not need to touch', () => {
    const ctx = writing();
    aRecord(ctx);
    const first = persisted();
    first.refresh();
    first.close();
    expect(existsSync(projectionCachePath({ root }))).toBe(true);
    plantAMarker();

    // Nothing arrived: the second open reads the frontier and stops.
    const second = persisted();
    second.refresh();
    expect(theMarkerSurvived(second), 'nothing arrived and the cache was built again').toBe(true);
    second.close();

    // Something arrived: it is in the answer, and what was not touched was not rewritten.
    const arrival = landed(createTask(ctx, { title: 'a task that arrived between two reads' }));
    ctx.writer.checkpoint();
    const third = persisted();
    third.refresh();
    expect(theMarkerSurvived(third), 'an arrival was answered by building it all again').toBe(true);
    expect(third.getTask(arrival.id)?.title).toBe('a task that arrived between two reads');
  });

  it('what it holds after an arrival, a transition and a move that diverged is what a replay holds', () => {
    const ctx = writing();
    const { task, decision } = aRecord(ctx);
    const warm = persisted();
    warm.refresh();
    warm.close();

    landed(transitionTask(ctx, { id: task, action: 'submit' }));
    landed(acceptDecision(ctx, { id: decision, fields: { note: 'accepted' } }));
    landed(captureMemory(ctx, { content: 'one more memory' }));
    // A colleague's tail moves the same decision out of the same state: the one thing the
    // reading of diverged moves exists to say.
    const colleague = mkdtempSync(join(tmpdir(), 'mnema-persisted-colleague-'));
    try {
      const other = openChainForWriting(root, { keyRoot: colleague });
      other.append(
        decisionTransitioned(
          {
            at: new Date(Date.now() + 5_000).toISOString(),
            who: other.anchor,
            signerFp: other.signerFingerprint,
            subject: decision,
          },
          { from: 'proposed', to: 'rejected', action: 'reject', fields: { note: 'not so' } },
        ),
      );
      other.checkpoint();
      ctx.writer.checkpoint();

      const next = persisted();
      next.refresh();
      expect(next.divergentMoves().map((move) => move.entityId)).toEqual([decision]);
      expect(rowsOf(projectionCachePath({ root }))).toEqual(rowsOfAReplay());
      expect(answersOf(next)).toEqual(answersOf(replayed()));
    } finally {
      rmSync(colleague, { recursive: true, force: true });
    }
  });

  it('a note taken back after the cache was read is taken back in the next read, in its row and in the index', () => {
    const ctx = writing();
    const task = aRecord(ctx).task;
    const memory = landed(captureMemory(ctx, { content: 'a memory about marmalade' })).id;
    const observation = landed(
      recordObservation(ctx, { about: task, topic: 'jam', text: 'an observation about marmalade' }),
    ).id;
    const warm = persisted();
    warm.refresh();
    expect(warm.search({ term: 'marmalade' }).total).toBe(2);
    warm.close();

    landed(retractNote(ctx, { id: memory, reason: 'it was wrong' }));
    // The second one is captured and taken back inside ONE arrival.
    const late = landed(captureMemory(ctx, { content: 'a memory about quince' })).id;
    landed(retractNote(ctx, { id: late, reason: 'wrong too' }));
    landed(retractNote(ctx, { id: observation, reason: 'also wrong' }));
    ctx.writer.checkpoint();

    const next = persisted();
    next.refresh();
    expect(next.getMemory(memory)?.retracted?.reason).toBe('it was wrong');
    expect(next.getMemory(late)?.retracted?.reason).toBe('wrong too');
    expect(next.getObservation(observation)?.retracted?.reason).toBe('also wrong');
    expect(next.search({ term: 'marmalade' }).total).toBe(0);
    expect(next.search({ term: 'quince' }).total).toBe(0);
    expect(rowsOf(projectionCachePath({ root }))).toEqual(rowsOfAReplay());
    expect(answersOf(next)).toEqual(answersOf(replayed()));
  });

  it('refreshed again and again it still equals one replay', () => {
    const ctx = writing();
    aRecord(ctx);
    for (let round = 0; round < 4; round += 1) {
      const cache = persisted();
      cache.refresh();
      cache.close();
      landed(captureMemory(ctx, { content: `memory ${round}` }));
      landed(switchChannel(ctx, { channel: 'a-channel', on: round % 2 === 0 }));
      ctx.writer.checkpoint();
    }
    const last = persisted();
    last.refresh();
    expect(rowsOf(projectionCachePath({ root }))).toEqual(rowsOfAReplay());
    expect(answersOf(last)).toEqual(answersOf(replayed()));
  });
});

describe('deleting the cache changes no answer', () => {
  it('every read a cache serves is the same from a file that was deleted and built again', () => {
    const ctx = writing();
    const { task } = aRecord(ctx);
    const warm = persisted();
    warm.refresh();
    landed(transitionTask(ctx, { id: task, action: 'submit' }));
    ctx.writer.checkpoint();
    warm.refresh();
    const withTheFile = answersOf(warm);
    warm.close();

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${projectionCachePath({ root })}${suffix}`, { force: true });
    }
    const without = persisted();
    without.refresh();
    expect(answersOf(without)).toEqual(withTheFile);
    expect(answersOf(without)).toEqual(answersOf(replayed()));
  });
});

describe('a cache that cannot be vouched for is replaced, never trusted', () => {
  /** Opens the file once, so there is a cache to distrust, and plants the marker a replay erases. */
  function aWarmFile(options: { maxSegmentBytes?: number } = {}): WriteContext {
    const ctx = writing(options);
    aRecord(ctx);
    const warm = persisted();
    warm.refresh();
    warm.close();
    plantAMarker();
    return ctx;
  }

  it('written by other code: the stamp is not this code’s', () => {
    aWarmFile();
    const db = openDatabase(projectionCachePath({ root }));
    db.prepare("UPDATE cache_meta SET value = 'another-product' WHERE key = 'stamp'").run();
    db.close();
    const cache = persisted();
    cache.refresh();
    expect(theMarkerSurvived(cache)).toBe(false);
    expect(answersOf(cache)).toEqual(answersOf(replayed()));
  });

  it('a tail that is gone', () => {
    aWarmFile();
    rmSync(join(root, 'tails'), { recursive: true, force: true });
    const cache = persisted();
    cache.refresh();
    expect(theMarkerSurvived(cache)).toBe(false);
    expect(cache.listTasks()).toEqual([]);
  });

  it('a tail whose earlier segment was cut', () => {
    const ctx = aWarmFile({ maxSegmentBytes: 2048 });
    const dir = tailDir({ root }, ctx.writer.tail);
    const segments = readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl') && name !== 'checkpoints.jsonl')
      .sort();
    expect(segments.length, 'the tail needs more than one segment to be cut').toBeGreaterThan(1);
    rmSync(join(dir, segments[0] as string));
    const cache = persisted();
    cache.refresh();
    expect(theMarkerSurvived(cache)).toBe(false);
    expect(answersOf(cache)).toEqual(answersOf(replayed()));
  });

  it('a segment put back to a shorter file than the cache had read', () => {
    // What restoring an earlier copy of a segment does: the last line of the shorter file
    // starts before the boundary the cache holds, which a resumed reading used to take for "no
    // arrival" — so it went on serving the entries the file no longer held.
    const ctx = aWarmFile();
    const file = join(tailDir({ root }, ctx.writer.tail), '000001.jsonl');
    const held = readFileSync(file, 'utf-8');
    const lines = held.trimEnd().split('\n');
    writeFileSync(file, `${lines.slice(0, -2).join('\n')}\n`);
    const cache = persisted();
    cache.refresh();
    expect(theMarkerSurvived(cache)).toBe(false);
    expect(answersOf(cache)).toEqual(answersOf(replayed()));
  });

  it('a sealed segment rewritten to the same size', () => {
    const ctx = aWarmFile({ maxSegmentBytes: 2048 });
    const dir = tailDir({ root }, ctx.writer.tail);
    const sealed = readdirSync(dir)
      .filter((name) => /^\d{6}\.jsonl$/.test(name))
      .sort()[0] as string;
    const file = join(dir, sealed);
    const held = readFileSync(file);
    const before = statSync(file);
    // The same length, a different byte, and a modification time a rewrite cannot keep.
    const rewritten = Buffer.from(held);
    const at = rewritten.indexOf('a task');
    expect(at, 'the segment holds the title the case rewrites').toBeGreaterThan(0);
    rewritten.write('A', at);
    writeFileSync(file, rewritten);
    utimesSync(file, new Date(before.atimeMs + 5_000), new Date(before.mtimeMs + 5_000));
    expect(statSync(file).size).toBe(before.size);
    const cache = persisted();
    cache.refresh();
    expect(theMarkerSurvived(cache), 'a rewritten sealed segment was served in silence').toBe(
      false,
    );
  });

  it('facts arriving stamped before something already covered', () => {
    aWarmFile();
    const colleague = mkdtempSync(join(tmpdir(), 'mnema-persisted-older-'));
    try {
      const older: WriteContext = {
        writer: openChainForWriting(root, { keyRoot: colleague }),
        layout: { root },
        upcasters,
        clock: () => '2000-01-01T00:00:00.000Z',
      };
      landed(captureMemory(older, { content: 'written long before, on another machine' }));
      older.writer.checkpoint();
      const cache = persisted();
      cache.refresh();
      expect(theMarkerSurvived(cache)).toBe(false);
      expect(cache.listMemories().map((memory) => memory.content)).toContain(
        'written long before, on another machine',
      );
    } finally {
      rmSync(colleague, { recursive: true, force: true });
    }
  });

  it('a file that is not a database at all', () => {
    const ctx = writing();
    aRecord(ctx);
    mkdirSync(join(root, 'locks'), { recursive: true });
    writeFileSync(
      projectionCachePath({ root }),
      'this is not sqlite, it is a file that was damaged',
    );
    const cache = persisted();
    cache.refresh();
    expect(cache.listTasks().map((task) => task.title)).toEqual(['a task that was already here']);
    expect(answersOf(cache)).toEqual(answersOf(replayed()));
  });

  it('a directory that cannot be written: the cache lives in memory and answers the same', () => {
    const ctx = writing();
    aRecord(ctx);
    // The writes above read through the kept projection, so it exists already: the case is the
    // directory that cannot be written when there is none yet.
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${projectionCachePath({ root })}${suffix}`, { force: true });
    }
    mkdirSync(join(root, 'locks'), { recursive: true });
    chmodSync(join(root, 'locks'), 0o555);
    try {
      const cache = persisted();
      cache.refresh();
      expect(answersOf(cache)).toEqual(answersOf(replayed()));
      expect(existsSync(projectionCachePath({ root }))).toBe(false);
    } finally {
      chmodSync(join(root, 'locks'), 0o755);
    }
  });
});

describe('a tree nobody has written to keeps nothing', () => {
  it('a read of a tree with no tail creates no directory', () => {
    const cache = persisted();
    cache.refresh();
    expect(cache.listTasks()).toEqual([]);
    expect(existsSync(join(root, 'locks'))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('two processes on one file', () => {
  it('the one that did not advance it takes what the file carries, and applies nothing twice', () => {
    const ctx = writing();
    aRecord(ctx);
    const behind = persisted();
    behind.refresh();
    const ahead = persisted();
    ahead.refresh();

    landed(captureMemory(ctx, { content: 'the first arrival' }));
    ctx.writer.checkpoint();
    ahead.refresh();
    landed(captureMemory(ctx, { content: 'the second arrival' }));
    ctx.writer.checkpoint();
    behind.refresh();
    ahead.refresh();

    expect(rowsOf(projectionCachePath({ root }))).toEqual(rowsOfAReplay());
    expect(
      behind
        .listMemories()
        .map((memory) => memory.content)
        .sort(),
    ).toEqual(['a memory already here', 'the first arrival', 'the second arrival']);
  });
});

describe('the answer to the stamp', () => {
  it('is the same across two opens of one process and moves with nothing a reader controls', () => {
    const ctx = writing();
    aRecord(ctx);
    const one = persisted();
    one.refresh();
    one.close();
    const db = openDatabase(projectionCachePath({ root }));
    const stamp = (
      db.prepare("SELECT value FROM cache_meta WHERE key = 'stamp'").get() as {
        value: string;
      }
    ).value;
    db.close();
    const two = persisted();
    two.refresh();
    two.close();
    const again = openDatabase(projectionCachePath({ root }));
    expect(
      (again.prepare("SELECT value FROM cache_meta WHERE key = 'stamp'").get() as { value: string })
        .value,
    ).toBe(stamp);
    again.close();
    expect(stamp).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('what a named path still means', () => {
  it('is the caller’s: a path that cannot be opened is an error, not a fallback', () => {
    expect(() =>
      ProjectionCache.open(root, { upcasters, dbPath: join(root, 'no', 'such', '\0', 'db') }),
    ).toThrow();
    expect(IN_MEMORY).toBe(':memory:');
  });
});

describe('linkBreaksAsOfNow names every tail that broke', () => {
  it('two tails whose last entry was appended a second time are both named, and a clean chain names none', () => {
    // It named the first break of the first broken tail, and a record whose two tails both broke
    // after the last reading answered with one of them.
    const ctx = writing();
    aRecord(ctx);
    const colleague = mkdtempSync(join(tmpdir(), 'mnema-persisted-two-'));
    try {
      const other = openChainForWriting(root, { keyRoot: colleague });
      const later: WriteContext = {
        writer: other,
        layout: { root },
        upcasters,
        clock: () => new Date(Date.now() + 60_000).toISOString(),
      };
      landed(captureMemory(later, { content: 'from the second tail' }));
      other.checkpoint();

      const cache = persisted();
      cache.refresh();
      expect(cache.linkBreaksAsOfNow(), 'a chain that chains').toEqual([]);

      for (const tail of [ctx.writer.tail, other.tail]) {
        const file = join(tailDir({ root }, tail), '000001.jsonl');
        const lines = readFileSync(file, 'utf-8').trimEnd().split('\n');
        appendFileSync(file, `${lines[lines.length - 1] as string}\n`);
      }
      const named = cache.linkBreaksAsOfNow();
      expect(named.map((broke) => broke.tail).sort()).toEqual([ctx.writer.tail, other.tail].sort());
    } finally {
      rmSync(colleague, { recursive: true, force: true });
    }
  });
});

describe('the census asks the links by their label', () => {
  it('reads one relation through an index rather than scanning every edge', () => {
    const db = openDatabase(IN_MEMORY);
    try {
      ensureSchema(db);
      const plan = db
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM links WHERE rel = ? ORDER BY target, subject')
        .all('governs') as { detail: string }[];
      const detail = plan.map((step) => step.detail).join(' | ');
      expect(detail).toContain('USING INDEX idx_links_rel');
      expect(detail).not.toContain('USE TEMP B-TREE');
    } finally {
      db.close();
    }
  });
});
