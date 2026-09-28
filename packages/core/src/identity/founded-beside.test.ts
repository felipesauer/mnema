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
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { ProjectionCache } from '../projections/cache.js';
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

  it('counts an anchor founded twice once, at its first founding — what two sessions of one installation leave', () => {
    const a = machine();
    writes(a, 'first');
    const anchorA = ensureFounded(a.ctx);
    // Two sessions of B's one installation: one key root, one tree, so one tail.
    const keyRoot = tmp('mnema-founded-beside-key-');
    const session = (): { fingerprint: string; ctx: WriteContext } => {
      const writer = openChainForWriting(tree, { keyRoot });
      return {
        fingerprint: writer.signerFingerprint,
        ctx: { writer, layout: { root: tree }, upcasters, clock },
      };
    };
    const one = session();
    const two = session();
    // They write together, so each decides before the other has written anything: the whole of
    // the second one's first write runs at the first write the first one makes after deciding —
    // its founding, or its anchor wherever the anchor goes first. Which one comes first is the
    // order `ensureFounded` keeps, and this reading owes the same answer under either.
    let raced = false;
    const firstWrites = new Set(['append', 'recordAnchor']);
    const racing = new Proxy(one.ctx.writer, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (typeof prop === 'string' && firstWrites.has(prop)) {
          return (...args: unknown[]) => {
            if (!raced) {
              raced = true;
              writes(two, 'session two');
            }
            return (value as (...given: unknown[]) => unknown).apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
    writes({ ctx: { ...one.ctx, writer: racing } }, 'session one');

    const events = orderedEvents({ root: tree }, upcasters);
    const ofB = events.filter(
      (e) => e.kind === 'identity.founded' && e.payload.foundingFp === one.fingerprint,
    );
    // Non-vacuity: the record really holds the anchor twice, by the key it derives from.
    expect(raced).toBe(true);
    expect(ofB).toHaveLength(2);
    expect(new Set(ofB.map((e) => e.subject)).size).toBe(1);

    expect(identitiesFoundedBeside(events)).toEqual([
      { anchor: ofB[0]?.subject, foundingFp: one.fingerprint, at: ofB[0]?.at, besides: [anchorA] },
    ]);
    // And the record takes the second founding as the copy it is.
    for (const m of [a, one, two]) m.ctx.writer.checkpoint();
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
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

describe('ProjectionCache.foundedBeside — the same reading, off the order a cache holds', () => {
  it('equals the reading off the chain, after a rebuild and after a refresh that brought one forward', () => {
    const a = machine();
    writes(a, 'first');
    const cache = ProjectionCache.open(tree, { upcasters });
    try {
      cache.rebuild();
      expect(cache.foundedBeside()).toEqual([]);

      // A second identity founds AFTER the cache was built: the order it answers from is the one
      // `refresh` brings forward, not a fresh replay.
      const b = machine();
      writes(b, 'a key nobody vouched for');
      cache.refresh();
      const offTheChain = identitiesFoundedBeside(orderedEvents({ root: tree }, upcasters));
      expect(offTheChain).toHaveLength(1);
      expect(cache.foundedBeside()).toEqual(offTheChain);

      cache.rebuild();
      expect(cache.foundedBeside()).toEqual(offTheChain);
    } finally {
      cache.close();
    }
  });
});
