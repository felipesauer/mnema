/**
 * THE BEHAVIOURAL HALF of `the-record-is-opened-and-closed-together.test.ts`.
 *
 * That file asserts that every door of this package goes through {@link withCache} and
 * {@link withOpenedCaches}. It says nothing about whether those two close, and a
 * centralisation onto a function that leaks is a leak with one site instead of three. What
 * is asserted here is the close itself, OBSERVED — not by counting handles, which nothing
 * here can do, but by the one thing a closed SQLite connection does differently from an
 * open one: it refuses to answer.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import { PROJECT_DIR, type ProjectionCache, type ResolvedTrees } from '@mnema/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withCache, withOpenedCaches } from './tree-sources.js';

let sandbox: string;
let chainRoot: string;
/**
 * A context holding a public tree and no private one — written as the type rather than
 * cast into it, because nothing type-checks a `.test.ts` in this workspace and a cast
 * here would be a fixture asserting a shape it never had.
 */
let trees: ResolvedTrees;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tree-sources-'));
  chainRoot = join(sandbox, PROJECT_DIR);
  ensureTree({ root: chainRoot });
  trees = {
    projectPublic: chainRoot,
    global: join(sandbox, 'global'),
    keyRoot: join(sandbox, 'k'),
  };
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Whether a cache still answers — the only observable difference a close makes. */
function stillAnswers(cache: ProjectionCache): boolean {
  try {
    cache.listRuns();
    return true;
  } catch {
    return false;
  }
}

describe('withCache closes what it opened', () => {
  it('answers while the read runs and refuses afterwards', () => {
    const escaped = withCache(chainRoot, catalogUpcasters(), (cache) => {
      // The cache is alive HERE — asserted inside, so a `close` moved before the read
      // would be red rather than silently serving nothing.
      expect(stillAnswers(cache)).toBe(true);
      return cache;
    });
    expect(stillAnswers(escaped)).toBe(false);
  });

  it('closes when the read throws, which is the case a bare call cannot get right', () => {
    let escaped: ProjectionCache | undefined;
    expect(() =>
      withCache(chainRoot, catalogUpcasters(), (cache) => {
        escaped = cache;
        throw new Error('the read threw');
      }),
    ).toThrow('the read threw');
    expect(escaped).toBeDefined();
    expect(stillAnswers(escaped as ProjectionCache)).toBe(false);
  });
});

describe('withOpenedCaches closes every tree the read opened', () => {
  it('closes the ones it opened and opens none it was not asked for', () => {
    const escaped = withOpenedCaches(trees, (open, opened) => {
      const source = open('public');
      expect(source?.chainRoot).toBe(chainRoot);
      // A tree this context does not have answers `undefined` rather than opening one.
      expect(open('private')).toBeUndefined();
      expect(opened.length).toBe(1);
      return opened.map((one) => one.cache);
    });
    expect(escaped.length).toBe(1);
    for (const cache of escaped) expect(stillAnswers(cache)).toBe(false);
  });

  it('closes them when the read throws', () => {
    let escaped: ProjectionCache | undefined;
    expect(() =>
      withOpenedCaches(trees, (open) => {
        escaped = open('public')?.cache;
        throw new Error('the read threw');
      }),
    ).toThrow('the read threw');
    expect(escaped).toBeDefined();
    expect(stillAnswers(escaped as ProjectionCache)).toBe(false);
  });
});
