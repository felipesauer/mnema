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
 *
 * The second load-bearing invariant, and the reason {@link WrittenEvent} exists:
 * both digests are over the form that was WRITTEN, never over the form a reader
 * gets back.
 */

import { createHash } from 'node:crypto';

import { type CanonicalValue, canonicalBytes } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { toCanonical } from '../events/parse.js';

/**
 * The domain tag every entry hash begins with. Exported off the package's public
 * surface — this module, not `index.ts` — because a doc and a published artifact
 * both NAME it, and a name typed into prose is a name that can come to differ
 * from the code. `FORMAT.md`'s guard and the vectors artifact read it from here,
 * so the day this becomes `v2` the two of them go red instead of going stale.
 */
export const ENTRY_DOMAIN = 'mnema.entry.v1';

/** The domain tag every content-root fold begins with. Named for the same reason. */
export const ROOT_DOMAIN = 'mnema.root.v1';

declare const writtenBrand: unique symbol;

/**
 * The event AS IT WAS WRITTEN: the canonical value whose bytes the entry hash
 * links and the checkpoint signature covers.
 *
 * It is a type of its own, and not merely a `CatalogEvent`, because the two are
 * not interchangeable and the difference is invisible at a call site. Reading a
 * stored line LIFTS the event through the registered upcasters (see
 * upcaster.ts), so what a reader holds is the event re-expressed under today's
 * contract — a READING, with the same standing as a projection. The proof was
 * made over the bytes that reached the disk, so it can only ever be recomputed
 * over those. Hand a lifted event to a digest and the first kind that ever gains
 * a v2 makes every chain written before it report as tampered: the entry hashes
 * stop matching (T1) and, worse, the checkpoint signatures stop verifying
 * (T2/T4) — a keyless-editor alarm raised by an honest read.
 *
 * The brand is what turns that rule into a compile error. A `CatalogEvent`
 * cannot be passed where a `WrittenEvent` is wanted, so a future digest site
 * cannot repeat the mistake by accident; it has to say which form it means, and
 * only the two producers below can say it.
 */
export interface WrittenEvent {
  readonly [writtenBrand]: true;
  /** The canonical value that was (or is about to be) serialized to the line. */
  readonly value: CanonicalValue;
}

/**
 * The written form of an event this process BUILT and is about to append. The
 * builder produces the current contract's shape, so what it will write is what
 * it holds — the write path's only source of a written form.
 */
export function writtenAsBuilt(event: CatalogEvent): WrittenEvent {
  return { value: toCanonical(event) } as WrittenEvent;
}

/**
 * The written form recovered from a stored line: the event object exactly as
 * `JSON.parse` returned it, BEFORE any upcaster ran and before the catalog
 * rebuilt it. Re-canonicalizing that value reproduces the bytes the writer
 * hashed, whatever version the line was written under.
 *
 * Re-canonicalizing rather than slicing the raw line is deliberate, and is the
 * property canonical.ts was built for: key order, whitespace, and Unicode
 * composition can all be changed by an honest reformat or a merge without
 * changing the fact, and the canonical form is what both sides agree on. What it
 * does NOT forgive is content: a field the writer never wrote, or one whose value
 * was edited, canonicalizes to different bytes and the recomputation says so.
 */
export function writtenAsStored(value: CanonicalValue): WrittenEvent {
  return { value } as WrittenEvent;
}

/** The canonical bytes of the written event — the content every proof is over. */
export function eventBytes(written: WrittenEvent): Uint8Array {
  return canonicalBytes(written.value);
}

/**
 * The entry hash: binds an event to its position (tail + seq) and its
 * predecessor. Recomputing it on read detects a corrupted line, a reordered
 * line, or a broken predecessor link, and points at exactly which entry. All
 * fields are length-framed under a domain tag so no field boundary is
 * ambiguous.
 *
 * It takes the WRITTEN event, not the read one: see {@link WrittenEvent}.
 */
export function entryHash(input: {
  event: WrittenEvent;
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
 *
 * It folds the WRITTEN events, not the read ones: see {@link WrittenEvent}.
 */
export function contentRoot(events: readonly WrittenEvent[]): string {
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
