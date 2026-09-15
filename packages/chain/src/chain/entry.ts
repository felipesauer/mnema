/**
 * A chain entry: one line of a tail's JSONL.
 *
 * An entry keeps the event and the chain-link SEPARATE. The `link` is the
 * chain's own bookkeeping — position and predecessor — added at write time.
 * Keeping them apart is what lets the content root be recomputed from the event
 * alone, independent of any stored hash.
 *
 * The event itself is carried TWICE, and the two are not redundant:
 *   - `event` is the READING — the catalog's current shape, lifted through the
 *     registered upcasters, which is what anything that wants meaning asks for
 *     (a projection, the enrollment fold, a surface);
 *   - `written` is the form that reached the disk, which is the only form the
 *     entry hash and the checkpoint signature can be recomputed over.
 *
 * They coincide today, when every kind is at v1 and nothing lifts, and they part
 * the first time a kind gains a v2. Proving over the reading instead of the
 * written form is the failure this separation exists to make impossible — see
 * {@link WrittenEvent}.
 */

import { type CanonicalValue, canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { parseEvent } from '../events/parse.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { oneLine } from '../one-line.js';
import { entryHash, type WrittenEvent, writtenAsBuilt, writtenAsStored } from './hash.js';

/** The chain-link fields the writer stamps onto an event. */
export interface EntryLink {
  /** The tail (machine) this entry belongs to. */
  readonly tail: string;
  /** Monotonic position within the tail, starting at 0. */
  readonly seq: number;
  /** Entry hash of the predecessor in this tail, or null for seq 0. */
  readonly prev: string | null;
  /** Entry hash of this entry (binds event + position + predecessor). */
  readonly hash: string;
}

/** A stored entry: the event — as read and as written — plus its chain-link. */
export interface Entry {
  /** The event under the CURRENT contract: lifted, for anything that reads meaning. */
  readonly event: CatalogEvent;
  /** The event as it reached the disk: the only form a proof may be recomputed over. */
  readonly written: WrittenEvent;
  readonly link: EntryLink;
}

/** Thrown when a stored line is not a structurally valid entry. */
export class EntryParseError extends Error {
  override readonly name = 'EntryParseError';
}

/**
 * Builds and seals an entry: computes the entry hash over the event, position,
 * and predecessor. The caller supplies the position and predecessor from the
 * tail's current head.
 *
 * The event handed in is by construction the form that will be written — it came
 * from a builder under the current contract and nothing has lifted it — so the
 * written form is taken here, once, and everything downstream (the hash, the
 * serialized line, the checkpoint the writer will sign) is over that one value.
 */
export function sealEntry(input: {
  event: CatalogEvent;
  tail: string;
  seq: number;
  prev: string | null;
}): Entry {
  const written = writtenAsBuilt(input.event);
  const hash = entryHash({ event: written, tail: input.tail, seq: input.seq, prev: input.prev });
  return {
    event: input.event,
    written,
    link: { tail: input.tail, seq: input.seq, prev: input.prev, hash },
  };
}

/**
 * Serializes an entry to its stored JSONL line (canonical, no trailing newline).
 * The line carries the WRITTEN event, so the bytes on disk are exactly the bytes
 * the entry hash was taken over — and re-serializing an entry read back from a
 * line reproduces that line rather than a lifted rewrite of it.
 */
export function serializeEntry(entry: Entry): string {
  const value: CanonicalValue = {
    event: entry.written.value,
    link: {
      tail: entry.link.tail,
      seq: entry.link.seq,
      prev: entry.link.prev,
      hash: entry.link.hash,
    },
  };
  return canonicalStringify(value);
}

/**
 * Parses one stored line back into an entry, validating the event against the
 * catalog and the link's shape. Does NOT check the hash chain — that is the
 * verifier's job over a whole tail; this only rebuilds the typed entry.
 *
 * It keeps BOTH forms of the event. The written form is taken from the raw
 * parsed object, before the upcaster ladder and before the catalog's rebuild, so
 * it is the value that produced the stored bytes however old the line is; the
 * read form is the fully lifted, fully validated event. Every proof recomputed
 * later goes over the first; everything that wants meaning takes the second.
 */
export function parseEntry(line: string, upcasters: UpcasterRegistry): Entry {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    throw new EntryParseError(`not valid JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EntryParseError('entry must be a JSON object');
  }
  const obj = raw as { event?: unknown; link?: unknown };
  if (typeof obj.event !== 'object' || obj.event === null) {
    throw new EntryParseError('entry is missing its event');
  }
  const link = parseLink(obj.link);
  // Sound by construction: `JSON.parse` only ever yields strings, finite
  // numbers, booleans, null, arrays, and plain objects — the closed set
  // CanonicalValue names. Whether it can be canonicalized at all (a lone
  // surrogate cannot) is decided when a proof actually asks for the bytes,
  // exactly as it was before, so an unencodable line fails the same way.
  const written = writtenAsStored(obj.event as CanonicalValue);
  let event: CatalogEvent;
  try {
    event = parseEvent(JSON.stringify(obj.event), upcasters);
  } catch (error) {
    throw new EntryParseError(`entry event is invalid: ${(error as Error).message}`);
  }
  return { event, written, link };
}

function parseLink(raw: unknown): EntryLink {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EntryParseError('entry is missing its link');
  }
  const obj = raw as { tail?: unknown; seq?: unknown; prev?: unknown; hash?: unknown };
  if (typeof obj.tail !== 'string' || obj.tail.length === 0) {
    throw new EntryParseError('entry link needs a tail');
  }
  if (typeof obj.seq !== 'number' || !Number.isInteger(obj.seq) || obj.seq < 0) {
    throw new EntryParseError('entry link needs a non-negative integer seq');
  }
  if (obj.prev !== null && (typeof obj.prev !== 'string' || obj.prev.length === 0)) {
    throw new EntryParseError('entry link prev must be a hash or null');
  }
  if (typeof obj.hash !== 'string' || obj.hash.length === 0) {
    throw new EntryParseError('entry link needs a hash');
  }
  return { tail: obj.tail, seq: obj.seq, prev: obj.prev, hash: obj.hash };
}

/**
 * WHY one entry does not follow the one before it on its tail — or `undefined` if it
 * does. The THREE structural questions, and nothing that costs a hash.
 *
 * ONE RULE, TWO READERS, and that is the whole reason this is a function rather than a
 * loop inside the verifier. The verifier asks it to form a T1 verdict (it goes on to
 * recompute each entry's hash, which is the part that needs the key material and the
 * cost that comes with it); the plain READ of a tail asks it so it can say that what it
 * is about to serve does not chain (`store.ts`). Two loops spelling the same three
 * comparisons is how one of them comes to accept a tail the other refuses — and a
 * reader more lenient than the verdict is precisely the shape that lets a broken record
 * be served in silence.
 *
 * It answers with the FINDING and not with the sentence, and {@link describeLinkBreak}
 * words it. That split is not ceremony: a caller that wants to branch on WHICH of the
 * three broke can, and the sentence has one author, so the verdict and the read cannot
 * come to describe the same bytes differently.
 *
 * It is per ENTRY rather than per tail so the verifier's loop keeps reporting the FIRST
 * thing wrong in the order it meets it: a hash mismatch at seq 2 must still win over a
 * seq gap at seq 5, which a whole-tail structural pass run first would have quietly
 * reversed.
 *
 * `expectedPrev` is null for the first entry of a tail, and `expectedSeq` counts from 0
 * — seqs run contiguously from the tail's birth, which is what makes a duplicate one
 * detectable at all.
 */
export type LinkBreakKind =
  /**
   * The entry is stored under a tail it does not name. The entry hash proves the line
   * is self-consistent, not that it lives where it claims: without this, copying a
   * tail's segments into a fabricated directory reads as a second, independent tail
   * whose chain checks out, and every event is counted twice.
   */
  | { readonly kind: 'foreign-tail'; readonly named: string; readonly storedUnder: string }
  | { readonly kind: 'seq-gap'; readonly expected: number; readonly found: number }
  | { readonly kind: 'prev-break' };

export function linkBreakAt(
  tail: string,
  entry: Entry,
  expectedSeq: number,
  expectedPrev: string | null,
): LinkBreakKind | undefined {
  if (entry.link.tail !== tail) {
    return { kind: 'foreign-tail', named: entry.link.tail, storedUnder: tail };
  }
  if (entry.link.seq !== expectedSeq) {
    return { kind: 'seq-gap', expected: expectedSeq, found: entry.link.seq };
  }
  if (entry.link.prev !== expectedPrev) return { kind: 'prev-break' };
  return undefined;
}

/**
 * The sentence a {@link LinkBreakKind} is reported as — the ONE wording, read by the
 * verdict and by the reads alike.
 *
 * Total over the union, so a fourth way for a tail to stop chaining does not compile
 * until somebody has said what a reader should be told about it.
 */
export function describeLinkBreak(broke: LinkBreakKind): string {
  switch (broke.kind) {
    case 'foreign-tail':
      return `entry names tail ${oneLine(broke.named)}, stored under ${oneLine(broke.storedUnder)}`;
    case 'seq-gap':
      return `seq gap: expected ${broke.expected}, found ${broke.found}`;
    case 'prev-break':
      return 'prev-hash break: does not chain to the previous entry';
  }
}
