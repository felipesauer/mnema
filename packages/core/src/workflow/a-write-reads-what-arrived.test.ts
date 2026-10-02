/**
 * A gated write reads the projection the tree keeps, brought forward to the chain as it stands, and
 * judges its caller's precondition under the lock.
 *
 *   - THE WRITE DOES NOT REPLAY THE RECORD. A row planted in the kept projection that no replay
 *     would write survives a numbered `recordDecision` and a transition: both read what arrived
 *     since, and the second reading `onTheRecordAsItStands` takes under the lock is the same cheap
 *     reading, which is what keeps a holder from keeping the lock for a whole replay.
 *   - THE NUMBER STAYS RIGHT: the label is the count the chain has, including a decision another
 *     writer appended between two writes.
 *   - A PRECONDITION OF THE CALLER'S IS JUDGED AGAIN UNDER THE LOCK when the chain moved after the
 *     first answer, so a refusal that lands in between is seen and nothing is appended.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting, projectionCachePath } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/sqlite.js';
import { captureMemory } from '../knowledge/operations.js';
import { ProjectionCache } from '../projections/cache.js';
import { acceptDecision, recordDecision } from './decision-operations.js';
import type { WriteContext } from './operations.js';
import { asTheChainIs, standing } from './read-the-record.js';

let root: string;
let keys: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-write-reads-'));
  keys = mkdtempSync(join(tmpdir(), 'mnema-write-reads-keys-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
});

function writing(): WriteContext {
  return {
    writer: openChainForWriting(root, { keyRoot: keys }),
    layout: { root },
    upcasters: catalogUpcasters(),
  };
}

function landed<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function plantAMarker(): void {
  const db = openDatabase(projectionCachePath({ root }));
  db.prepare(
    "INSERT INTO memories (id, content, who, captured_at) VALUES ('a-marker', 'not from the chain', 'nobody', '2000-01-01T00:00:00.000Z')",
  ).run();
  db.close();
}

function theMarkerSurvives(): boolean {
  const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters(), persist: true });
  try {
    return cache.listMemories().some((memory) => memory.id === 'a-marker');
  } finally {
    cache.close();
  }
}

describe('a write reads what arrived and not the whole record', () => {
  it('a numbered record and a move leave a planted row alone, and the number is the chain’s', () => {
    const ctx = writing();
    const first = landed(recordDecision(ctx, { title: 'one', rationale: 'because' }));
    expect(first.adr).toBe('ADR-1');
    ctx.writer.checkpoint();
    // A read keeps the projection; then a row no replay would write is planted in it.
    asTheChainIs(ctx, (cache) => cache.countDecisions());
    plantAMarker();

    // Another writer's decision lands between two of ours.
    const other = writing();
    landed(recordDecision(other, { title: 'two', rationale: 'because' }));
    other.writer.checkpoint();

    const third = landed(recordDecision(ctx, { title: 'three', rationale: 'because' }));
    expect(third.adr).toBe('ADR-3');
    landed(acceptDecision(ctx, { id: first.id, fields: { note: 'accepted' } }));
    expect(theMarkerSurvives(), 'a write built the projection again').toBe(true);
  });

  it('standing and asTheChainIs answer as the chain is now', () => {
    const ctx = writing();
    const one = landed(recordDecision(ctx, { title: 'one', rationale: 'because' }));
    ctx.writer.checkpoint();
    expect(asTheChainIs(ctx, (cache) => cache.countDecisions())).toBe(1);
    const seen = standing(ctx, [one.id, undefined, 'nothing-here'], (cache, id) =>
      cache.getDecision(id),
    );
    expect([...seen.keys()]).toEqual([one.id]);
  });
});

describe('a caller’s precondition is judged under the lock', () => {
  it('a refusal that lands after the first answer and before the append is seen, and nothing is appended', () => {
    const ctx = writing();
    const decision = landed(recordDecision(ctx, { title: 'one', rationale: 'because' }));
    ctx.writer.checkpoint();
    const other = writing();

    let asked = 0;
    const moved = acceptDecision(ctx, {
      id: decision.id,
      fields: { note: 'accepted' },
      refusedWhen: () => {
        asked += 1;
        if (asked === 1) {
          // The first answer is "fine", and then something lands on the chain.
          landed(captureMemory(other, { content: 'a switch turned off, say' }));
          return undefined;
        }
        return { code: 'A_RULE_OF_THE_SURFACE', message: 'refused when asked again' };
      },
    });
    expect(asked).toBe(2);
    expect(moved).toMatchObject({ ok: false, code: 'A_RULE_OF_THE_SURFACE' });
    const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters() });
    cache.refresh();
    expect(cache.getDecision(decision.id)?.state).toBe('proposed');
    cache.close();
  });

  it('is asked once when nothing landed in between', () => {
    const ctx = writing();
    const decision = landed(recordDecision(ctx, { title: 'one', rationale: 'because' }));
    ctx.writer.checkpoint();
    let asked = 0;
    const moved = acceptDecision(ctx, {
      id: decision.id,
      fields: { note: 'accepted' },
      refusedWhen: () => {
        asked += 1;
        return undefined;
      },
    });
    expect(moved.ok).toBe(true);
    expect(asked).toBe(1);
  });
});
