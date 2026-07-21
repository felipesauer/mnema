/**
 * A chain entry: one line of a tail's JSONL.
 *
 * An entry keeps the event and the chain-link SEPARATE. The `event` is exactly
 * what the catalog produces and what canonicalizes to the content bytes; the
 * `link` is the chain's own bookkeeping — position and predecessor — added at
 * write time. Keeping them apart is what lets the content root be recomputed
 * from the event alone, independent of any stored hash.
 */

import { type CanonicalValue, canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { parseEvent, toCanonical } from '../events/parse.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { entryHash } from './hash.js';

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

/** A stored entry: the event plus its chain-link. */
export interface Entry {
  readonly event: CatalogEvent;
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
 */
export function sealEntry(input: {
  event: CatalogEvent;
  tail: string;
  seq: number;
  prev: string | null;
}): Entry {
  const hash = entryHash(input);
  return {
    event: input.event,
    link: { tail: input.tail, seq: input.seq, prev: input.prev, hash },
  };
}

/** Serializes an entry to its stored JSONL line (canonical, no trailing newline). */
export function serializeEntry(entry: Entry): string {
  const value: CanonicalValue = {
    event: toCanonical(entry.event),
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
  let event: CatalogEvent;
  try {
    event = parseEvent(JSON.stringify(obj.event), upcasters);
  } catch (error) {
    throw new EntryParseError(`entry event is invalid: ${(error as Error).message}`);
  }
  return { event, link };
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
