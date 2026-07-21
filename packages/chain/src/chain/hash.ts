/**
 * Hashing primitives for the chain.
 *
 * Two distinct digests, kept separate on purpose:
 *   - the ENTRY hash links an entry to its predecessor and position (T1: it
 *     detects accidental corruption and reordering);
 *   - the CONTENT ROOT is folded from the canonical event BYTES alone and is
 *     what a checkpoint signs (T2/T4).
 *
 * The load-bearing invariant: the content root is recomputed from the event
 * bytes, never from a stored entry hash. If the root were folded over stored
 * hashes, an adversary who edits an event and then repairs the keyless
 * hash-chain would leave the stored head unchanged — and the signature over it
 * would still verify. Folding over the content means editing any event flips
 * the root even after every entry hash is repaired, so the Ed25519 signature no
 * longer matches.
 *
 * Every digest is over a FRAMED byte stream: each field is preceded by its
 * length, and each construction begins with a domain tag. Plain concatenation
 * would let two different field tuples collide (`"a"+"bc"` vs `"ab"+"c"`);
 * framing makes the split points unambiguous, so distinct inputs always produce
 * distinct bytes and only a real SHA-256 collision could forge a match.
 */

import { createHash } from 'node:crypto';

import { canonicalBytes } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { toCanonical } from '../events/parse.js';

const ENTRY_DOMAIN = 'mnema.entry.v1';
const ROOT_DOMAIN = 'mnema.root.v1';

/** Hex SHA-256 of the given bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The canonical bytes of an event — the content the proof is over. */
export function eventBytes(event: CatalogEvent): Uint8Array {
  return canonicalBytes(toCanonical(event));
}

/**
 * The entry hash: binds an event to its position (tail + seq) and its
 * predecessor. Recomputing it on read detects a corrupted line, a reordered
 * line, or a broken predecessor link, and points at exactly which entry. All
 * fields are length-framed under a domain tag so no field boundary is
 * ambiguous.
 */
export function entryHash(input: {
  event: CatalogEvent;
  tail: string;
  seq: number;
  prev: string | null;
}): string {
  const h = new FramedHash(ENTRY_DOMAIN);
  h.field(eventBytes(input.event));
  h.text(input.tail);
  h.text(String(input.seq));
  // A null predecessor (genesis) is framed as a distinct empty field, not as
  // the empty string, so "no predecessor" and "predecessor \"\"" never collide.
  h.field(input.prev === null ? new Uint8Array() : new TextEncoder().encode(input.prev));
  h.text(input.prev === null ? 'genesis' : 'linked');
  return h.hex();
}

/**
 * Folds a content root over a sequence of events, recomputing from their
 * canonical bytes. Each step frames the running accumulator and the next
 * event's bytes under a domain tag, so a two-event sequence can never fold to
 * the same root as a one-event sequence, and no event can be silently moved
 * across a boundary. An empty range has a fixed, distinct root.
 */
export function contentRoot(events: readonly CatalogEvent[]): string {
  let acc = new FramedHash(ROOT_DOMAIN).text('empty').digest();
  for (const event of events) {
    acc = new FramedHash(ROOT_DOMAIN).field(acc).field(eventBytes(event)).digest();
  }
  return acc.toString('hex');
}

/**
 * A SHA-256 over a length-framed, domain-tagged byte stream. Each `field` is
 * written as a 4-byte big-endian length followed by its bytes, so the reader of
 * the digest input can never confuse where one field ends and the next begins.
 */
class FramedHash {
  private readonly h = createHash('sha256');

  constructor(domain: string) {
    this.field(new TextEncoder().encode(domain));
  }

  field(bytes: Uint8Array): this {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length, 0);
    this.h.update(len);
    this.h.update(bytes);
    return this;
  }

  text(value: string): this {
    return this.field(new TextEncoder().encode(value));
  }

  digest(): Buffer {
    return this.h.digest();
  }

  hex(): string {
    return this.digest().toString('hex');
  }
}
