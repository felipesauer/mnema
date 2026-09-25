/**
 * The entries of a tail that a checkpoint covers — found without walking the tail once per
 * checkpoint.
 *
 * THE QUESTION IS ONE `filter`, AND THE ANSWER HAS TO STAY THAT FILTER'S TO THE BYTE:
 * every entry whose `seq` lies in `[fromSeq, toSeq]`, in the order the tail holds them.
 * The verifier used to ask it exactly so, over the whole tail, for every checkpoint — and
 * this product signs a checkpoint per act, so the checkpoints grow with the events and the
 * question cost the tail's length times its own length. Measured over records the
 * product's own writer wrote: 2 s at 10 thousand events, 8 to 9 s at 31.6 thousand, 78 to
 * 114 s at 100 thousand. The verb a CI runs on every push was quadratic in the history.
 *
 * WHAT MAKES A SHORTER ROUTE EXACT is one fact about the tail, checked once: its seqs never
 * go DOWN along the file. When they do not, the entries that lie in a range are one
 * unbroken run of it — any entry between two that lie in `[fromSeq, toSeq]` has a seq
 * between theirs, so it lies there too — and that run is the slice from the first seq at or
 * above `fromSeq` to the first seq above `toSeq`, in the file's own order. Two binary
 * searches find it. A sound tail runs 0, 1, 2 … and qualifies; so does a tail with an
 * entry appended twice or a line cut out of the middle, which are the breaks two writers
 * or an editor leave, and for which the slice holds the duplicate or skips the hole
 * exactly as the filter did.
 *
 * A TAIL WHOSE SEQS DO GO DOWN KEEPS THE FILTER, as written before, because for it the
 * entries in a range need not sit together and the slice would answer something else. It
 * is a tail the hash chain already refuses (T1 reads the first seq out of place), so what
 * it pays is time and never a verdict — and the verdict it gets is the one it always got.
 * That is a decision and not an oversight: the only tail that still costs the square is a
 * tail somebody reordered, and making it cheap would put a second, cleverer reading of a
 * range beside this one for the one case where nothing is being proven anyway.
 *
 * `range.test.ts` holds the slice to the filter over tails of every shape, and
 * `verify-costs-what-the-record-holds.test.ts` counts what a whole verification touches.
 */

import type { Entry } from './entry.js';

/** The entries whose `seq` lies in `[fromSeq, toSeq]`, in the order the tail holds them. */
export type EntriesBetween = (fromSeq: number, toSeq: number) => readonly Entry[];

/**
 * How to ask a tail for the entries a checkpoint covers — the filter's answer, by the
 * cheapest route that stays exact for THESE entries. Decided once per tail, in one pass.
 */
export function entriesBetween(entries: readonly Entry[]): EntriesBetween {
  if (!seqsNeverFall(entries)) {
    return (fromSeq, toSeq) => entries.filter((e) => e.link.seq >= fromSeq && e.link.seq <= toSeq);
  }
  return (fromSeq, toSeq) =>
    entries.slice(
      firstWhere(entries, (seq) => seq >= fromSeq),
      firstWhere(entries, (seq) => seq > toSeq),
    );
}

/** Whether no entry's seq is lower than the seq of the entry before it. */
function seqsNeverFall(entries: readonly Entry[]): boolean {
  for (let i = 1; i < entries.length; i += 1) {
    if ((entries[i] as Entry).link.seq < (entries[i - 1] as Entry).link.seq) return false;
  }
  return true;
}

/**
 * The first position whose seq satisfies `holds`, or the length when none does — over seqs
 * that never fall, for a condition that, once true, stays true along them.
 */
function firstWhere(entries: readonly Entry[], holds: (seq: number) => boolean): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (holds((entries[middle] as Entry).link.seq)) high = middle;
    else low = middle + 1;
  }
  return low;
}
