/**
 * A cache in memory gets its tables once per process and is not asked to drop them to make them
 * again: counted at the two calls that do it, so the proof is a number of calls and no time.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ ensure: 0, drop: 0 }));

vi.mock('../db/schema.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/schema.js')>();
  return {
    ...real,
    ensureSchema: (...args: Parameters<typeof real.ensureSchema>) => {
      calls.ensure += 1;
      return real.ensureSchema(...args);
    },
    dropProjections: (...args: Parameters<typeof real.dropProjections>) => {
      calls.drop += 1;
      return real.dropProjections(...args);
    },
  };
});

import { ProjectionCache } from './cache.js';

const canCopySchema = typeof new DatabaseSync(':memory:').serialize === 'function';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-memory-schema-'));
  calls.ensure = 0;
  calls.drop = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('opening a cache in memory', () => {
  it('drops nothing on the way to its first replay', () => {
    for (let i = 0; i < 3; i += 1) {
      const cache = ProjectionCache.open(root);
      cache.refresh();
      cache.close();
    }
    expect(calls.drop).toBe(0);
  });

  it('creates the tables once for the process where the runtime can copy a schema, and once per cache where it cannot', () => {
    for (let i = 0; i < 3; i += 1) {
      const cache = ProjectionCache.open(root);
      cache.refresh();
      cache.close();
    }
    // The process may already have made its image in an earlier test of this file's worker, so
    // the count is at most one on a runtime that copies and exactly one per cache on one that does not.
    if (canCopySchema) expect(calls.ensure).toBeLessThanOrEqual(1);
    else expect(calls.ensure).toBe(3);
  });

  it('still drops what a second replay finds, because by then the tables hold rows', () => {
    const cache = ProjectionCache.open(root);
    cache.refresh();
    expect(calls.drop).toBe(0);
    cache.rebuild();
    expect(calls.drop).toBe(1);
    cache.close();
  });

  it('answers the same from a copied schema as from one made on the spot', () => {
    const first = ProjectionCache.open(root);
    first.refresh();
    const second = ProjectionCache.open(root);
    second.refresh();
    expect(second.listDecisions()).toEqual(first.listDecisions());
    expect(second.listTasks()).toEqual([]);
    first.close();
    second.close();
  });
});
