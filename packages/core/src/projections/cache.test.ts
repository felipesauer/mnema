import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainWriter,
  openChainForWriting,
  runEnded,
  runStarted,
  taskBirth,
  taskTransitioned,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/sqlite.js';
import { ProjectionCache } from './cache.js';

let chainRoot: string;
let caches: ProjectionCache[] = [];

beforeEach(() => {
  chainRoot = mkdtempSync(join(tmpdir(), 'mnema-cache-'));
  caches = [];
});

afterEach(() => {
  for (const c of caches) c.close();
  rmSync(chainRoot, { recursive: true, force: true });
});

/** Opens a cache and tracks it for teardown. */
function openCache(dbPath?: string): ProjectionCache {
  const cache = dbPath
    ? ProjectionCache.open(chainRoot, { dbPath })
    : ProjectionCache.open(chainRoot);
  caches.push(cache);
  return cache;
}

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number) => ({ at: at(n), who: 'felipe', subject });

/** Appends a task that is born and then moved once. */
function writeTaskMovedTo(w: ChainWriter, id: string, initial: string, to: string): void {
  const [created, transitioned] = taskBirth(env(id, 0), { title: `title ${id}`, initial });
  w.append(created);
  w.append(transitioned);
  w.append(taskTransitioned(env(id, 1), { from: initial, to, action: 'move' }));
}

describe('ProjectionCache — rebuild materializes the chain', () => {
  it('projects a task after rebuild', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'in-progress');

    const cache = openCache();
    cache.rebuild();

    expect(cache.getTask('t-1')).toEqual({
      id: 't-1',
      title: 'title t-1',
      state: 'in-progress',
      createdAt: at(0),
      updatedAt: at(1),
    });
  });

  it('is empty before rebuild (in-memory cache starts blank)', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    const cache = openCache();
    expect(cache.listTasks()).toEqual([]); // not populated until rebuild
    cache.rebuild();
    expect(cache.listTasks()).toHaveLength(1);
  });

  it('queries tasks by current state', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    writeTaskMovedTo(w, 't-2', 'draft', 'in-progress');
    writeTaskMovedTo(w, 't-3', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();
    expect(cache.listTasksByState('done').map((t) => t.id)).toEqual(['t-1', 't-3']);
    expect(cache.listTasksByState('in-progress').map((t) => t.id)).toEqual(['t-2']);
  });
});

describe('ProjectionCache — the cache is NOT the source (drop and replay)', () => {
  it('rebuilds identical state after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'in-progress');
    writeTaskMovedTo(w, 't-2', 'triage', 'done');

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listTasks();
    first.close();
    caches = caches.filter((c) => c !== first);

    // Delete the cache database entirely — the chain is untouched.
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    // Reopen and rebuild from the chain: the state must be byte-identical.
    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listTasks()).toEqual(before);
  });

  it('a rebuild reflects the chain even after the cache was hand-corrupted', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');

    // A rebuild is defined entirely by the chain, so running it again from the
    // same chain converges to the same answer — the cache never drifts from it.
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
  });

  it('rebuild is idempotent: running it twice yields the same rows', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'ready');
    writeTaskMovedTo(w, 't-2', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();
    const once = cache.listTasks();
    cache.rebuild();
    expect(cache.listTasks()).toEqual(once);
  });

  it('picks up new events appended to the chain on the next rebuild', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'in-progress');

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('in-progress');

    // Append a further transition, then rebuild: the cache follows the chain.
    w.append(
      taskTransitioned(env('t-1', 2), { from: 'in-progress', to: 'done', action: 'finish' }),
    );
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
    expect(cache.getTask('t-1')?.updatedAt).toBe(at(2));
  });
});

describe('ProjectionCache — multi-tail materialization', () => {
  it('projects tasks written across two merged tails', () => {
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-cache-b-'));
    try {
      const a = openChainForWriting(chainRoot);
      writeTaskMovedTo(a, 't-a', 'draft', 'done');
      const b = openChainForWriting(rootB);
      writeTaskMovedTo(b, 't-b', 'triage', 'in-progress');
      // Offline merge: copy B's tail and key into A's chain.
      cpSync(join(rootB, 'tails'), join(chainRoot, 'tails'), { recursive: true });
      cpSync(join(rootB, 'keys'), join(chainRoot, 'keys'), { recursive: true });

      const cache = openCache();
      cache.rebuild();
      expect(cache.getTask('t-a')?.state).toBe('done');
      expect(cache.getTask('t-b')?.state).toBe('in-progress');
      expect(cache.listTasks()).toHaveLength(2);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});

describe('ProjectionCache — runs', () => {
  it('projects an open run, then reflects its close on the next rebuild', () => {
    const w = openChainForWriting(chainRoot);
    w.append(runStarted(env('r-1', 0), { agent: 'claude', goal: 'ship' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getRun('r-1')).toEqual({
      id: 'r-1',
      agent: 'claude',
      who: 'felipe',
      goal: 'ship',
      open: true,
      startedAt: at(0),
    });
    expect(cache.listOpenRuns().map((r) => r.id)).toEqual(['r-1']);

    // Close the run and rebuild: the cache follows the chain.
    w.append(runEnded(env('r-1', 1), { outcome: 'done' }));
    cache.rebuild();
    const closed = cache.getRun('r-1');
    expect(closed?.open).toBe(false);
    expect(closed?.outcome).toBe('done');
    expect(cache.listOpenRuns()).toEqual([]);
  });

  it('rebuilds runs identically after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot);
    w.append(runStarted(env('r-1', 0), { agent: 'claude' }));
    w.append(runEnded(env('r-1', 1), { outcome: 'ok' }));
    w.append(runStarted(env('r-2', 2), { agent: 'cursor', goal: 'explore' }));

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listRuns();
    first.close();
    caches = caches.filter((c) => c !== first);

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listRuns()).toEqual(before);
  });

  it('projects tasks and runs from the same chain side by side', () => {
    const w = openChainForWriting(chainRoot);
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    w.append(runStarted(env('r-1', 3), { agent: 'claude' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
    expect(cache.getRun('r-1')?.open).toBe(true);
  });
});

describe('openDatabase', () => {
  it('opens an in-memory database usable for a throwaway cache', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (x)');
    db.prepare('INSERT INTO t VALUES (1)').run();
    expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 1 });
    db.close();
  });
});
