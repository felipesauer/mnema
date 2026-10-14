/**
 * The events about a few subjects, read off the chain itself, in the order every reader folds —
 * what a gate judges a move on, so that it judges what the record says and not what a file beside
 * the record says it says.
 *
 * WHY NOT THE PROJECTION. The projection the tree keeps is a cache: unsigned, on the same disk,
 * and rebuilt at will. Measured on the built binary, a row of it edited by hand was enough for
 * every state machine to append a move its own gate refuses, signed, and passed by `verify`. A
 * gate that reads the projection vouches for the projection.
 *
 * WHY NOT A REPLAY. A replay parses every line of every tail, and a write that has to read again
 * under the tail's lock held it for 1.35 s at 100 thousand events, which is what made a third
 * session waiting behind two of them run out of the lock's wait (`TAIL_BUSY`).
 *
 * WHAT THIS DOES INSTEAD: it searches the BYTES of every segment for the subject's id as the
 * envelope writes it — `"subject":` and the id as a canonical JSON string — and parses only the
 * lines that contain it, through the same parse every reader uses. Why that is the whole set:
 *
 *   - Every line a reader accepts is canonical (FORMAT.md §4: a line that is not exactly the
 *     canonical serialization of the value it holds — a space, a key out of order, a letter
 *     written as an escape, another Unicode composition — is refused, by both readers). In a
 *     canonical line the envelope's `subject` is written as exactly those bytes. So a line about
 *     the subject that this search does not find is a line no reader accepts: the record is
 *     broken there for `verify` and for every read that reaches it, whatever this returns.
 *   - A line that contains the bytes but is not about the subject — a payload object with a key
 *     of that name; the id in free text does not match, since a quote inside a string is written
 *     `\"` — is parsed and then dropped by the subject it really has. The search can only find
 *     too much, never too little.
 *   - A line the search finds is parsed in full ({@link parseStoredLine}, {@link parseEntry}), so
 *     what it hands back is refused exactly where a replay would refuse it, torn last line
 *     included.
 *
 * THE ORDER. Inside a tail the order is the tail's own, always (FORMAT.md, "Reading many tails"),
 * so a subject every event of which is on one tail is ordered by where its lines are, and that is
 * the common case: one machine writes the subject's whole life. A subject moved on more than one
 * tail is placed by the merge itself ({@link causalOrder}), and the merge needs the instant, the
 * citations and the entry hash of EVERY entry, since a head that cites holds its tail back. Those
 * three are read off the canonical bytes without parsing the line: the envelope's keys are sorted,
 * so a line begins with `{"event":{"after":[…],"at":"…"` or `{"event":{"at":"…"`, and it ends with
 * its link, whose first key is the entry hash. A line of any other shape is parsed in full. The
 * same caveat as the search holds, and for the same reason: what the light read could misread is
 * a line that is not canonical, which no reader accepts.
 *
 * WHAT IT DOES NOT CHECK. It is not a verification: signatures, checkpoints and the links between
 * entries are `verify`'s. What it promises is narrower and is the one a gate needs: the events it
 * returns are the ones a replay of this tree would fold for these subjects, in the order it would
 * fold them.
 */

import { readFileSync } from 'node:fs';

import { canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { causalOrder } from './causal-order.js';
import { type Entry, parseEntry } from './entry.js';
import type { ChainLayout } from './layout.js';
import { parseStoredLine } from './lines.js';
import { listTails, orderedSegments } from './store.js';

const NEWLINE = 0x0a;
const QUOTE = 0x22;
const CLOSE_BRACKET = 0x5d;
/** How a canonical line begins when its event cites nothing: `at` is its first key. */
const PLAIN_HEAD = Buffer.from('{"event":{"at":"');
/** How a canonical line begins when its event cites: `after` sorts before `at`. */
const CITING_HEAD = Buffer.from('{"event":{"after":[');
const AT_AFTER_CITATIONS = Buffer.from('],"at":"');
/** The link is the last key of a line, and its first key is the entry hash. */
const LINK_HASH = Buffer.from(',"link":{"hash":"');
const HASH_LENGTH = 64;

/** One line about a wanted subject: where it is, and the event it holds. */
interface Found {
  readonly tail: number;
  readonly segment: number;
  readonly start: number;
  readonly event: CatalogEvent;
}

/** What the merge needs of each entry of one tail, by position. */
interface TailKeys {
  readonly at: string[];
  readonly after: (readonly string[] | undefined)[];
  readonly hash: string[];
}

/**
 * The events whose envelope `subject` is each of `ids`, in the order a replay of this tree folds
 * them — every one of them, and nothing else. An id with none maps to an empty list.
 *
 * Throws what a replay throws on a line it finds: a line that does not parse is refused, and the
 * torn last line of a tail is dropped as it is everywhere.
 */
export function subjectEvents(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  ids: readonly string[],
): Map<string, CatalogEvent[]> {
  const tails = listTails(layout);
  const segments = tails.map((tail) => orderedSegments(layout, tail));
  const wanted = [...new Set(ids)].map((id) => ({
    id,
    needle: Buffer.from(`"subject":${canonicalStringify(id)}`, 'utf8'),
  }));
  const found = new Map<string, Found[]>(wanted.map(({ id }) => [id, []]));

  segments.forEach((files, tail) => {
    files.forEach((file, segment) => {
      const raw = readFileSync(file);
      const isLast = segment === files.length - 1;
      // A line two needles both find is parsed once.
      const parsed = new Map<number, Entry | null>();
      for (const { id, needle } of wanted) {
        const mine = found.get(id) as Found[];
        let from = 0;
        for (;;) {
          const hit = raw.indexOf(needle, from);
          if (hit < 0) break;
          const start = raw.lastIndexOf(NEWLINE, hit) + 1;
          const newline = raw.indexOf(NEWLINE, hit);
          const end = newline < 0 ? raw.length : newline;
          from = end + 1;
          let entry = parsed.get(start);
          if (entry === undefined) {
            entry = parseStoredLine(
              raw.subarray(start, end),
              isLast && newline < 0,
              (text) => parseEntry(text, upcasters),
              () => `${file} byte offset ${start}`,
            );
            parsed.set(start, entry);
          }
          if (entry !== null && entry.event.subject === id) {
            mine.push({ tail, segment, start, event: entry.event });
          }
        }
      }
    });
  });

  const answer = new Map<string, CatalogEvent[]>();
  let rank: Map<Found, number> | undefined;
  for (const { id } of wanted) {
    const mine = found.get(id) as Found[];
    // Found tail by tail, segment by segment, line by line: on one tail that IS the order.
    if (new Set(mine.map((one) => one.tail)).size > 1) {
      rank ??= mergedRank(segments, tails, upcasters, [...found.values()].flat());
      const of = rank;
      mine.sort((a, b) => (of.get(a) as number) - (of.get(b) as number));
    }
    answer.set(
      id,
      mine.map((one) => one.event),
    );
  }
  return answer;
}

/**
 * Where each of `found` falls in the merge of every tail — the one order every reader folds,
 * computed over keys read off the bytes ({@link keysOfTail}).
 */
function mergedRank(
  segments: readonly (readonly string[])[],
  tails: readonly string[],
  upcasters: UpcasterRegistry,
  found: readonly Found[],
): Map<Found, number> {
  const looked = tails.map(() => new Map<number, Map<number, Found>>());
  for (const one of found) {
    const bySegment = looked[one.tail] as Map<number, Map<number, Found>>;
    const byStart = bySegment.get(one.segment) ?? new Map<number, Found>();
    byStart.set(one.start, one);
    bySegment.set(one.segment, byStart);
  }
  const atPosition = tails.map(() => new Map<number, Found>());
  const keys = segments.map((files, tail) =>
    keysOfTail(files, upcasters, (segment, start, position) => {
      const one = looked[tail]?.get(segment)?.get(start);
      if (one !== undefined) atPosition[tail]?.set(position, one);
    }),
  );
  const merged = causalOrder(
    tails.map((tail, index) => ({ tree: 0, tail, length: (keys[index] as TailKeys).at.length })),
    {
      at: (tail, position) => (keys[tail] as TailKeys).at[position] as string,
      hash: (tail, position) => (keys[tail] as TailKeys).hash[position] as string,
      after: (tail, position) => (keys[tail] as TailKeys).after[position],
    },
  );
  const cursors = tails.map(() => 0);
  const rank = new Map<Found, number>();
  merged.steps.forEach((tail, step) => {
    const position = cursors[tail] as number;
    cursors[tail] = position + 1;
    const one = atPosition[tail]?.get(position);
    if (one !== undefined) rank.set(one, step);
  });
  return rank;
}

/**
 * The merge's keys of every entry of one tail, by position, and `seen` told where each position's
 * line is. A position is a line a reader accepts — the empty piece after a final newline is none,
 * and a torn last line that does not parse is none — so the positions are the ones a replay has.
 */
function keysOfTail(
  files: readonly string[],
  upcasters: UpcasterRegistry,
  seen: (segment: number, start: number, position: number) => void,
): TailKeys {
  const keys: TailKeys = { at: [], after: [], hash: [] };
  files.forEach((file, segment) => {
    const raw = readFileSync(file);
    const isLast = segment === files.length - 1;
    let start = 0;
    while (start < raw.length) {
      const newline = raw.indexOf(NEWLINE, start);
      const end = newline < 0 ? raw.length : newline;
      if (end > start) {
        const read =
          (newline < 0 ? undefined : keysOfLine(raw, start, end)) ??
          keysOfParsedLine(raw, start, end, isLast && newline < 0, upcasters, file);
        if (read !== null) {
          seen(segment, start, keys.at.length);
          keys.at.push(read.at);
          keys.after.push(read.after);
          keys.hash.push(read.hash);
        }
      }
      if (newline < 0) break;
      start = newline + 1;
    }
  });
  return keys;
}

interface LineKeys {
  readonly at: string;
  readonly after: readonly string[] | undefined;
  readonly hash: string;
}

/** The keys of a canonical line, read off its bytes; undefined for a line of any other shape. */
function keysOfLine(raw: Buffer, start: number, end: number): LineKeys | undefined {
  let at: number;
  let after: string[] | undefined;
  if (begins(raw, start, end, PLAIN_HEAD)) {
    at = start + PLAIN_HEAD.length;
  } else if (begins(raw, start, end, CITING_HEAD)) {
    const open = start + CITING_HEAD.length;
    const close = raw.indexOf(CLOSE_BRACKET, open);
    if (close < 0 || !begins(raw, close, end, AT_AFTER_CITATIONS)) return undefined;
    after = [];
    for (const quoted of raw.toString('latin1', open, close).split(',')) {
      if (quoted.length !== HASH_LENGTH + 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) {
        return undefined;
      }
      after.push(quoted.slice(1, -1));
    }
    at = close + AT_AFTER_CITATIONS.length;
  } else {
    return undefined;
  }
  const atEnd = raw.indexOf(QUOTE, at);
  if (atEnd < 0 || atEnd >= end) return undefined;
  const link = raw.lastIndexOf(LINK_HASH, end - 1);
  if (link < atEnd) return undefined;
  const hash = link + LINK_HASH.length;
  if (hash + HASH_LENGTH >= end || raw[hash + HASH_LENGTH] !== QUOTE) return undefined;
  return {
    at: raw.toString('utf8', at, atEnd),
    after,
    hash: raw.toString('latin1', hash, hash + HASH_LENGTH),
  };
}

/** The keys of a line by parsing it, as a replay does: null for a torn last line it drops. */
function keysOfParsedLine(
  raw: Buffer,
  start: number,
  end: number,
  couldBeTorn: boolean,
  upcasters: UpcasterRegistry,
  file: string,
): LineKeys | null {
  const entry = parseStoredLine(
    raw.subarray(start, end),
    couldBeTorn,
    (text) => parseEntry(text, upcasters),
    () => `${file} byte offset ${start}`,
  );
  if (entry === null) return null;
  return { at: entry.event.at, after: entry.event.after, hash: entry.link.hash };
}

/** Whether the bytes of `raw` at `start`, short of `end`, begin with `prefix`. */
function begins(raw: Buffer, start: number, end: number, prefix: Buffer): boolean {
  return (
    start + prefix.length <= end &&
    raw.compare(prefix, 0, prefix.length, start, start + prefix.length) === 0
  );
}
