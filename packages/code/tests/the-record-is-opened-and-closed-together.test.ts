/**
 * OPENING A CACHE AND CLOSING IT ARE ONE CALL — and the guard is that nothing else in this
 * package writes the open.
 *
 * WHAT WAS MEASURED. Six modules of `code/src` opened a `ProjectionCache` directly. Three
 * of them never closed it: `commands/guard.ts` and `commands/next-actions.ts` opened a
 * cache for the one tree a task lives in and returned the answer, and `pinned-run.ts` —
 * which runs on EVERY write that reads `MNEMA_RUN` — opened one and returned through four
 * exits, none of them a close. The other three did close: `tree-sources.ts` in a `finally`,
 * `commands/show.ts` in its own, and `mcp/cache-registry.ts` deliberately not until the
 * session ends.
 *
 * WHAT IT COSTS TODAY, SAID PLAINLY, because a guard whose motivation is inflated is a
 * guard somebody deletes. `CacheOptions.dbPath` has no production caller, so every one of
 * these caches is IN MEMORY: what a missed close leaks is a SQLite handle and the tables
 * behind it, in a command-line process that exits within the second. The measurable bill
 * on this machine is nothing. The defect is that three of six doors had no close and a
 * reader could not tell which three without opening all six — and that the day one of
 * those three is called from the MCP server, which stays up across a session, the same
 * code leaks a handle per request.
 *
 * SO THE RULE IS A SITE AND NOT A HABIT. `tree-sources.ts` owns the pair ({@link
 * withCache}, {@link withOpenedCaches}), and this file says no other module may write the
 * open. A rule stated as "remember to close it" is a rule with one site per caller and no
 * way to check any of them; stated as "there is one place that opens", it is a sweep.
 *
 * THE ONE EXEMPTION IS NAMED AND IS THE OPPOSITE CASE. `mcp/cache-registry.ts` holds a
 * cache open past the call that made it ON PURPOSE — that is what a warm cache IS, and the
 * measurement behind it is in that file — so it closes in `closeAll()` at the end of a
 * session instead. An exemption for a module that simply forgot would be the hole; this
 * one is for the module whose whole job is the other lifetime.
 *
 * ## What it does not answer
 *
 * That `withCache` closes. That is a behavioural fact and it is asserted in
 * `tree-sources.test.ts`, on a cache whose `close` is observed. This half asserts that the
 * doors go through it.
 */

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const SRC = join(import.meta.dirname, '..', 'src');

/** Opening a cache, as a CALL — the identifier alone is the import and the doc-comment. */
const OPENS_A_CACHE = 'ProjectionCache.open(';

/**
 * The two modules that may write it, by path relative to `src`.
 *
 * `tree-sources.ts` is the pair itself. `mcp/cache-registry.ts` is the deliberate other
 * lifetime — a cache kept warm for a session and closed with the session.
 */
const MAY_OPEN_A_CACHE = ['tree-sources.ts', 'mcp/cache-registry.ts'];

/** Every module of `src` that ships, by path relative to it. */
const shipped = sourceFiles(SRC).map((path) =>
  path
    .slice(SRC.length + 1)
    .split(sep)
    .join('/'),
);

/** Whether one module's CODE — prose and string literals blanked — opens a cache. */
function opensACache(relative: string): boolean {
  return codeOnly(readFileSync(join(SRC, relative), 'utf-8')).includes(OPENS_A_CACHE);
}

describe('a cache is opened where it is closed, and nowhere else', () => {
  it('read the package it claims to have read', () => {
    // The vacuous form of every case here is a sweep that walked nothing: it finds no
    // opener, reports success, and would keep reporting it if `src` were renamed.
    expect(shipped.length).toBeGreaterThan(80);
    for (const named of MAY_OPEN_A_CACHE) expect(shipped).toContain(named);
    expect(shipped).toContain('commands/guard.ts');
    expect(shipped).toContain('commands/next-actions.ts');
    expect(shipped).toContain('pinned-run.ts');
    expect(shipped).toContain('commands/show.ts');
  });

  it('lets no module but the two that own a lifetime open a cache', () => {
    expect(shipped.filter(opensACache).sort()).toEqual([...MAY_OPEN_A_CACHE].sort());
  });

  it('names no module that stopped opening one', () => {
    // The other half, and it is the half that rots: a name left in the list above after
    // its module changed is an exemption for a door that no longer exists, and the next
    // reader takes it for a classification of a module that opens one.
    expect(MAY_OPEN_A_CACHE.filter((named) => !opensACache(named))).toEqual([]);
  });

  it('would accuse the three that leaked — on the text they held', () => {
    // THE TEETH, on the exact line each of the three carried before this delivery.
    const asItWas =
      '  const cache = ProjectionCache.open(root, { upcasters });\n  cache.rebuild();';
    expect(codeOnly(asItWas).includes(OPENS_A_CACHE)).toBe(true);
    // And it is not a constant: the import the modules keep, and a mention in prose or in
    // a string, are not a door.
    expect(codeOnly("import { ProjectionCache } from '@mnema/core';").includes(OPENS_A_CACHE)).toBe(
      false,
    );
    expect(
      codeOnly('/**\n * every `ProjectionCache.open(` of this package.\n */').includes(
        OPENS_A_CACHE,
      ),
    ).toBe(false);
    expect(codeOnly("const how = 'ProjectionCache.open(';").includes(OPENS_A_CACHE)).toBe(false);
  });
});
