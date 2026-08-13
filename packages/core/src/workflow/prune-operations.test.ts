/**
 * Authorizing a cut, from the core: what the operation READS, what it refuses, and
 * what it hands to the record.
 *
 * The property under everything here is that a caller cannot state what the waiver
 * claims. The input carries WHICH tail and WHY; the head hash, the event count and
 * the anchor the tail served all come off the disk, through the same function the
 * writer's own door checks them with. That is what makes the door unreachable from
 * this path — and what makes a waiver evidence rather than an assertion.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import { createTask, type WriteContext } from './operations.js';
import { authorizeTailPrune } from './prune-operations.js';

const upcasters = catalogUpcasters();

let root: string;
let elsewhere: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-prune-'));
  elsewhere = mkdtempSync(join(tmpdir(), 'mnema-prune-other-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

function contextIn(chainRoot: string): WriteContext {
  return {
    writer: openChainForWriting(chainRoot, { keyRoot: chainRoot }),
    layout: { root: chainRoot },
    upcasters,
  };
}

/** A second machine's tail, merged in the way an offline copy is: its files, its key. */
function secondMachine(): { tail: string; anchor: string } {
  const ctx = contextIn(elsewhere);
  const created = createTask(ctx, { title: 'work another machine did' });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  for (const tail of readdirSync(join(elsewhere, 'tails'))) {
    mkdirSync(join(root, 'tails', tail), { recursive: true });
    for (const file of readdirSync(join(elsewhere, 'tails', tail))) {
      writeFileSync(
        join(root, 'tails', tail, file),
        readFileSync(join(elsewhere, 'tails', tail, file), 'utf-8'),
      );
    }
  }
  for (const key of readdirSync(join(elsewhere, 'keys'))) {
    if (!key.endsWith('.pub')) continue;
    writeFileSync(join(root, 'keys', key), readFileSync(join(elsewhere, 'keys', key), 'utf-8'));
  }
  return { tail: ctx.writer.tail, anchor: ctx.writer.anchor };
}

/** The `tail.pruned` on the record, or a failure saying what was there instead. */
function waiverOn(ctx: WriteContext) {
  const events = orderedEvents(ctx.layout, upcasters);
  const waiver = events.find((event) => event.kind === 'tail.pruned');
  if (waiver?.kind !== 'tail.pruned') {
    throw new Error(`no waiver on the record: ${events.map((e) => e.kind).join(', ')}`);
  }
  return waiver;
}

describe('authorizing a cut reads its claims off the record', () => {
  it('writes the head, the count and the anchor the record holds — none of them supplied', () => {
    const ctx = contextIn(root);
    const other = secondMachine();

    const done = authorizeTailPrune(ctx, {
      tail: other.tail,
      reason: 'the person asked to be taken out of the record',
    });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;

    // A task's birth is two events, plus the founding: three on that tail.
    expect(done.eventCount).toBe(3);
    expect(done.anchor).toBe(other.anchor);

    const waiver = waiverOn(ctx);
    expect(waiver.payload.tail).toBe(other.tail);
    expect(waiver.payload.eventCount).toBe(done.eventCount);
    expect(waiver.payload.throughHash).toBe(done.throughHash);
    expect(waiver.payload.reason).toBe('the person asked to be taken out of the record');
    // The SUBJECT is the anchor that tail served; the `who` is whoever authorized the
    // cut. On one machine authorizing another's tail these differ, and the record
    // keeps both.
    expect(waiver.subject).toBe(other.anchor);
    expect(waiver.who).not.toBe(other.anchor);
  });

  it('screens the reason like any other prose a caller writes', () => {
    const ctx = contextIn(root);
    const other = secondMachine();
    const done = authorizeTailPrune(ctx, {
      tail: other.tail,
      reason: 'rotating out, key was AKIAIOSFODNN7EXAMPLE',
    });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;
    expect(done.replaced).toEqual(['aws-access-key']);
    expect(waiverOn(ctx).payload.reason).toBe('rotating out, key was <SECRET:aws-access-key>');
  });
});

describe('what it refuses, in words rather than by throwing', () => {
  it('refuses the tail this write lands on', () => {
    const ctx = contextIn(root);
    expect(createTask(ctx, { title: 'something to point at' }).ok).toBe(true);

    const refused = authorizeTailPrune(ctx, { tail: ctx.writer.tail, reason: 'cut myself' });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('TAIL_IS_OWN');
    expect(refused.message).toContain('outlive');
  });

  it('refuses a tail this tree does not hold', () => {
    const ctx = contextIn(root);
    const refused = authorizeTailPrune(ctx, {
      tail: `${'a'.repeat(64)}-nowhere`,
      reason: 'a tail from another world',
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('UNKNOWN_TAIL');
  });

  it('refuses the empty tail a read-only session leaves behind', () => {
    // The state that must never be waivable: a tail directory with an ownership
    // proof and no event, which is what opening a write context to READ the anchor
    // leaves. There is nothing to account for, and a waiver over it would put
    // "pruned under authorization" on the most innocent shape there is.
    const ctx = contextIn(root);
    const reader = openChainForWriting(elsewhere, { keyRoot: elsewhere });
    mkdirSync(join(root, 'tails', reader.tail), { recursive: true });
    for (const file of readdirSync(join(elsewhere, 'tails', reader.tail))) {
      writeFileSync(
        join(root, 'tails', reader.tail, file),
        readFileSync(join(elsewhere, 'tails', reader.tail, file), 'utf-8'),
      );
    }

    const refused = authorizeTailPrune(ctx, { tail: reader.tail, reason: 'nothing there' });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('UNKNOWN_TAIL');
    expect(refused.message).toContain('nothing to account for');
  });

  it('refuses an oversize reason before it reads anything at all', () => {
    const ctx = contextIn(root);
    const refused = authorizeTailPrune(ctx, {
      tail: `${'a'.repeat(64)}-nowhere`,
      reason: 'x'.repeat(64 * 1024 + 1),
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // The size check runs first, so the refusal names the SIZE and not the tail —
    // which is what makes an oversize write cost nothing and touch nothing.
    expect(refused.code).toBe('CONTENT_TOO_LARGE');
  });
});
