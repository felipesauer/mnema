import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, openChainForWriting, taskCreated } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents, orderedEventsAcross } from '../projections/order.js';

let publicRoot: string;
let privateRoot: string;
let globalRoot: string;
let keyRoot: string;

beforeEach(() => {
  publicRoot = mkdtempSync(join(tmpdir(), 'mnema-pub-'));
  privateRoot = mkdtempSync(join(tmpdir(), 'mnema-prv-'));
  globalRoot = mkdtempSync(join(tmpdir(), 'mnema-glb-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-key-'));
});

afterEach(() => {
  for (const r of [publicRoot, privateRoot, globalRoot, keyRoot]) {
    rmSync(r, { recursive: true, force: true });
  }
});

const upcasters = catalogUpcasters();

/** Writes one `task.created` at `at` into the chain at `root`, returning its id. */
function writeTask(root: string, at: string, title: string): string {
  const w = openChainForWriting(root, { keyRoot });
  const entry = w.append(
    taskCreated({ at, who: 'felipe', signerFp: 'fp-1', subject: `sub-${title}` }, { title }),
  );
  return (entry.event as { subject: string }).subject;
}

const layout = (root: string): ChainLayout => ({ root });

describe('orderedEventsAcross — union of three trees', () => {
  it('shows events from all three trees, interleaved by time', () => {
    writeTask(publicRoot, '2026-07-21T00:00:00.000Z', 'pub');
    writeTask(privateRoot, '2026-07-21T00:00:01.000Z', 'prv');
    writeTask(globalRoot, '2026-07-21T00:00:02.000Z', 'glb');

    const union = orderedEventsAcross(
      [layout(publicRoot), layout(privateRoot), layout(globalRoot)],
      upcasters,
    );
    expect(union.map((e) => e.subject)).toEqual(['sub-pub', 'sub-prv', 'sub-glb']);
  });

  it('reading ONLY the public tree does not show private or global events', () => {
    writeTask(publicRoot, '2026-07-21T00:00:00.000Z', 'pub');
    writeTask(privateRoot, '2026-07-21T00:00:01.000Z', 'prv');
    writeTask(globalRoot, '2026-07-21T00:00:02.000Z', 'glb');

    // The team's view: just the public chain, as a plain single-chain read.
    const publicOnly = orderedEvents(layout(publicRoot), upcasters);
    expect(publicOnly.map((e) => e.subject)).toEqual(['sub-pub']);
  });

  it('drops trees that do not exist (empty layouts contribute nothing)', () => {
    writeTask(publicRoot, '2026-07-21T00:00:00.000Z', 'pub');
    // privateRoot and globalRoot are never written to — no tails on disk.
    const union = orderedEventsAcross(
      [layout(publicRoot), layout(privateRoot), layout(globalRoot)],
      upcasters,
    );
    expect(union.map((e) => e.subject)).toEqual(['sub-pub']);
  });
});

describe('orderedEventsAcross — distinct ids across trees never collide', () => {
  it('two trees each with an event counts BOTH, never de-duplicating', () => {
    // The false-merge base: distinct v7 ids across trees are distinct events; the
    // union is a plain interleave, no de-duplication and no double-counting.
    writeTask(publicRoot, '2026-07-21T00:00:00.000Z', 'one');
    writeTask(globalRoot, '2026-07-21T00:00:01.000Z', 'two');
    const union = orderedEventsAcross([layout(publicRoot), layout(globalRoot)], upcasters);
    expect(union).toHaveLength(2);
    expect(new Set(union.map((e) => e.subject)).size).toBe(2);
  });

  it('is deterministic when two trees share an `at` (tie-break is stable)', () => {
    // Same person, same key → the two chains can carry tails with the same id.
    // The tree-qualified stream key must still give ONE stable total order.
    const sameAt = '2026-07-21T00:00:00.000Z';
    writeTask(publicRoot, sameAt, 'p');
    writeTask(globalRoot, sameAt, 'g');
    const first = orderedEventsAcross([layout(publicRoot), layout(globalRoot)], upcasters);
    const second = orderedEventsAcross([layout(publicRoot), layout(globalRoot)], upcasters);
    expect(first.map((e) => e.subject)).toEqual(second.map((e) => e.subject));
    expect(first).toHaveLength(2);
  });
});
