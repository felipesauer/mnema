/**
 * A note can be retracted: a later signed fact takes a memory or an observation out of what
 * the record serves, and keeps it.
 *
 * Driven through the two seams a surface uses — the write operation and the projection cache —
 * against a real tree in a sandbox. What is held:
 *   - the reads that LIST notes (the search with and without a term, the observations about an
 *     entity, the memory listing) no longer serve a retracted note;
 *   - the read that opens ONE note by id still serves it, saying when, by whom and why;
 *   - the chain keeps both facts, and verifies;
 *   - what is not a note, a note that is not there, a note already taken back and a reason
 *     that says nothing are refused, and a refusal appends nothing.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectionCache } from '../projections/cache.js';
import { orderedEvents } from '../projections/order.js';
import { resolveTrees } from '../topology/resolve.js';
import { chainRootForScope, openTreeForWriting } from '../topology/routing.js';
import { recordDecision } from '../workflow/decision-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { captureMemory, recordObservation, retractNote } from './operations.js';

const upcasters = catalogUpcasters();
const REASON = 'The load turned out to be a key lookup, not relational.';

/** A cache over `root`, replayed from the chain. */
function replayed(root: string): ProjectionCache {
  const cache = ProjectionCache.open(root);
  cache.rebuild();
  return cache;
}

describe('a note can be retracted', () => {
  let sandbox: string;
  let ctx: WriteContext;
  let root: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-retract-'));
    mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
    const trees = resolveTrees(join(sandbox, 'repo'), { home: join(sandbox, 'home') });
    root = chainRootForScope(trees, 'public') as string;
    ctx = { writer: openTreeForWriting(trees, 'public'), layout: { root }, upcasters };
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function memory(content: string): string {
    const captured = captureMemory(ctx, { content });
    if (!captured.ok) throw new Error(captured.message);
    return captured.id;
  }

  const eventCount = (): number => orderedEvents(ctx.layout, upcasters).length;

  it('takes a memory out of the search and the listing, and the read by id still serves it', () => {
    const kept = memory('The queue drains every night at two.');
    const taken = memory('The cache is SQLite because the load is relational.');

    const retracted = retractNote(ctx, { id: taken, reason: REASON, which: 'claude' });
    expect(retracted.ok).toBe(true);
    ctx.writer.checkpoint();

    const cache = replayed(root);
    try {
      expect(cache.search().hits.map((h) => h.id)).toEqual([kept]);
      expect(cache.search({ term: 'relational' }).hits).toEqual([]);
      expect(cache.listMemories().map((m) => m.id)).toEqual([kept]);

      const opened = cache.getMemory(taken);
      expect(opened?.content).toBe('The cache is SQLite because the load is relational.');
      expect(opened?.retracted?.reason).toBe(REASON);
      expect(opened?.retracted?.which).toBe('claude');
      expect(opened?.retracted?.who).toBe(opened?.who);
      expect(opened?.retracted?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(cache.getMemory(kept)?.retracted).toBeUndefined();
    } finally {
      cache.close();
    }

    // Nothing was erased: both facts are in the chain, and it verifies.
    const kinds = orderedEvents(ctx.layout, upcasters).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'memory.captured')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'note.retracted')).toHaveLength(1);
    expect(verify(root).ok).toBe(true);
  });

  it('takes an observation out of the reads that list it', () => {
    const about = memory('The suite runs on node 22 and 24.');
    const observed = recordObservation(ctx, {
      about,
      topic: 'flake',
      text: 'The suite reddens on a cold cache.',
    });
    if (!observed.ok) throw new Error(observed.message);

    expect(
      retractNote(ctx, { id: observed.id, reason: 'It was the machine, not the cache.' }).ok,
    ).toBe(true);

    const cache = replayed(root);
    try {
      expect(cache.listObservationsAbout(about)).toEqual([]);
      expect(cache.search({ term: 'cold' }).hits).toEqual([]);
      expect(cache.search({ kind: 'observation' }).total).toBe(0);
      expect(cache.getObservation(observed.id)?.retracted?.reason).toBe(
        'It was the machine, not the cache.',
      );
    } finally {
      cache.close();
    }
  });

  it('a cache opened before the retraction stops serving the note once it refreshes', () => {
    const taken = memory('The cache is SQLite because the load is relational.');
    const cache = replayed(root);
    try {
      expect(cache.search({ term: 'relational' }).hits.map((h) => h.id)).toEqual([taken]);
      expect(retractNote(ctx, { id: taken, reason: REASON }).ok).toBe(true);
      cache.refresh();
      expect(cache.search({ term: 'relational' }).hits).toEqual([]);
      expect(cache.getMemory(taken)?.retracted?.reason).toBe(REASON);
    } finally {
      cache.close();
    }
  });

  it('refuses a decision, which keeps its own lifecycle, and appends nothing', () => {
    const decided = recordDecision(ctx, {
      title: 'SQLite for the cache',
      rationale: 'Relational.',
    });
    if (!decided.ok) throw new Error(decided.message);
    const before = eventCount();

    const refused = retractNote(ctx, { id: decided.id, reason: REASON });
    expect(refused).toMatchObject({ ok: false, code: 'NOT_A_NOTE' });
    expect(refused.ok ? '' : refused.message).toContain('supersede');
    expect(eventCount()).toBe(before);
  });

  it('refuses an id this tree holds no note for', () => {
    memory('Something.');
    const before = eventCount();
    const refused = retractNote(ctx, {
      id: '019f81f8-e400-7001-8000-0000000000ff',
      reason: REASON,
    });
    expect(refused).toMatchObject({ ok: false, code: 'UNKNOWN_NOTE' });
    expect(eventCount()).toBe(before);
  });

  it('refuses a note already retracted, and says when', () => {
    const taken = memory('The cache is SQLite because the load is relational.');
    expect(retractNote(ctx, { id: taken, reason: REASON }).ok).toBe(true);
    const before = eventCount();

    const again = retractNote(ctx, { id: taken, reason: 'Again.' });
    expect(again).toMatchObject({ ok: false, code: 'ALREADY_RETRACTED' });
    expect(eventCount()).toBe(before);
  });

  it('refuses a reason that says nothing', () => {
    const taken = memory('The cache is SQLite because the load is relational.');
    const before = eventCount();
    expect(retractNote(ctx, { id: taken, reason: '' }).ok).toBe(false);
    expect(retractNote(ctx, { id: taken, reason: '<why>' }).ok).toBe(false);
    expect(retractNote(ctx, { id: taken, reason: '***' }).ok).toBe(false);
    expect(eventCount()).toBe(before);
  });
});
