/**
 * What a NEWER mnema wrote into the record that this one reads past (ADR-113, ADR-140).
 *
 * A line of a kind this binary does not know is checked by `verify` and left out of every
 * projection: a surface that serves the record serves it without the line, and without this it
 * serves it in silence. The reading may then be out of date in a way nothing in the answer shows:
 * a line that moved a decision, or took a task out of the work in flight, is not applied here.
 *
 * ONE QUESTION, ASKED OF THE LINES THE CACHES ALREADY CARRIED OUT OF THEIR READING
 * ({@link ProjectionCache.unread}), and grouped by the one grouping `verify` takes
 * (`groupUnreadLines`), so the count a surface says is the count `verify` names. Nothing here
 * reads a kind again or knows which kinds are known: that rule has one site (`readsKind`).
 *
 * It says kinds and numbers and never a payload, since there is none to say. Absent when there are
 * none, which is every record this version wrote, so every answer that carries it is unchanged
 * over such a record.
 */

import { groupUnreadLines, type ProjectionCache, type UnreadLine } from '@mnema/core';

/** The lines of one kind a newer mnema wrote: the kind, as the line names it, and how many. */
export interface NewerKind {
  readonly kind: string;
  readonly lines: number;
}

/** Every line of a kind this binary does not know, across the trees asked about. */
export interface NewerLines {
  /** How many lines in all. */
  readonly lines: number;
  /** By kind, in the order the kinds are first met. */
  readonly kinds: readonly NewerKind[];
}

/**
 * The lines a newer mnema wrote, summed and grouped: from the lines themselves, for a reading that
 * has none of the caches (`mnema doctor`, which writes nothing and so opens no cache file).
 */
export function newerLinesFrom(lines: readonly UnreadLine[]): NewerLines | undefined {
  if (lines.length === 0) return undefined;
  return {
    lines: lines.length,
    kinds: groupUnreadLines(lines).map(({ kind, lines: count }) => ({ kind, lines: count })),
  };
}

/** The lines a newer mnema wrote in `caches`, or undefined when there are none. */
export function newerLinesOf(caches: readonly ProjectionCache[]): NewerLines | undefined {
  return newerLinesFrom(caches.flatMap((cache) => cache.unread));
}

/**
 * The lines a newer mnema wrote whose SUBJECT is `id`: the record they say something about, which
 * is the record a reading of `id` may be out of date about. Undefined when none names it.
 */
export function newerLinesAbout(
  caches: readonly ProjectionCache[],
  id: string,
): NewerLines | undefined {
  return newerLinesFrom(
    caches.flatMap((cache) => cache.unread.filter((line) => line.subject === id)),
  );
}
