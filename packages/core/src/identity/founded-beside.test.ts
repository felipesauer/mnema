/**
 * An identity founded where others already were, read off events the product's own writers
 * stored — never off events written by hand, so every case below is a record the product can
 * produce.
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  enrollmentMessage,
  materializePublicKey,
  openChainForWriting,
  sign,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from '../workflow/clock.js';
import { enrollKey, ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { foundedBesideBy, identitiesFoundedBeside } from './founded-beside.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];
let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-09-24T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

beforeEach(() => {
  scratch = [];
  tick = 0;
  tree = tmp('mnema-founded-beside-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A machine: its own key root, and a writer over the shared tree. */
function machine(): { keyRoot: string; fingerprint: string; ctx: WriteContext } {
  const keyRoot = tmp('mnema-founded-beside-key-');
  const writer = openChainForWriting(tree, { keyRoot });
  return {
    keyRoot,
    fingerprint: writer.signerFingerprint,
    ctx: { writer, layout: { root: tree }, upcasters, clock },
  };
}

/** A first write by `m`: whatever it settles, it settles on the way in. */
function writes(m: { ctx: WriteContext }, note: string): void {
  const captured = captureMemory(m.ctx, { content: note });
  if (!captured.ok) throw new Error(`setup: ${captured.message}`);
}

describe('identitiesFoundedBeside — read off the record', () => {
  it('is empty for a tree one identity founded, however much it wrote', () => {
    const a = machine();
    writes(a, 'one');
    writes(a, 'two');
    expect(identitiesFoundedBeside(orderedEvents({ root: tree }, upcasters))).toEqual([]);
  });

  it('names the second identity, beside the first — and when, and by which key', () => {
    const a = machine();
    writes(a, 'first');
    const b = machine();
    writes(b, 'a key nobody vouched for');
    const found = identitiesFoundedBeside(orderedEvents({ root: tree }, upcasters));
    const anchorA = ensureFounded(a.ctx);
    const anchorB = ensureFounded(b.ctx);
    expect(found).toEqual([
      {
        anchor: anchorB,
        foundingFp: b.fingerprint,
        at: expect.stringMatching(/^2026-09-24T/),
        besides: [anchorA],
      },
    ]);
  });

  it('names every identity already there, in the order the record has them', () => {
    const [a, b, c] = [machine(), machine(), machine()];
    writes(a, 'a');
    writes(b, 'b');
    writes(c, 'c');
    const found = identitiesFoundedBeside(orderedEvents({ root: tree }, upcasters));
    expect(found.map((one) => one.besides.length)).toEqual([1, 2]);
    expect(found[1]?.besides).toEqual([ensureFounded(a.ctx), ensureFounded(b.ctx)]);
  });

  it('has nothing to say about a key that ADOPTED an identity the record proves it a member of', () => {
    // The second machine the page tells a person to bring in: vouched for before it writes.
    const a = machine();
    writes(a, 'first');
    const anchor = ensureFounded(a.ctx);
    const b = machine();
    const bKey = createPrivateKey(
      readFileSync(join(b.keyRoot, 'keys', `${b.fingerprint}.key`), 'utf-8'),
    );
    const bPublic = createPublicKey(
      readFileSync(join(b.keyRoot, 'keys', `${b.fingerprint}.pub`), 'utf-8'),
    );
    materializePublicKey({ root: tree }, { publicKey: bPublic, fingerprint: b.fingerprint });
    const enrolled = enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: Buffer.from(sign(enrollmentMessage(anchor, b.fingerprint), bKey)).toString('hex'),
    });
    expect(enrolled.ok).toBe(true);
    writes(b, 'the laptop, joined');
    expect(identitiesFoundedBeside(orderedEvents({ root: tree }, upcasters))).toEqual([]);
    expect(foundedBesideBy(tree, b.fingerprint, upcasters)).toBeUndefined();
  });
});

describe('foundedBesideBy — the question a surface asks right after a write', () => {
  it('answers for the key that founded beside others, and for no other key', () => {
    const a = machine();
    writes(a, 'first');
    const b = machine();
    writes(b, 'second');
    expect(foundedBesideBy(tree, b.fingerprint, upcasters)?.anchor).toBe(ensureFounded(b.ctx));
    // The first founding was beside nothing.
    expect(foundedBesideBy(tree, a.fingerprint, upcasters)).toBeUndefined();
  });
});
