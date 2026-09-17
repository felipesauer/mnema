/**
 * WHETHER WHAT THE RECORD PROVED IS STILL A STATEMENT ABOUT THE WHOLE RECORD — asked on
 * a clock, and answered without reading a chain.
 *
 * The console rules on the record ONCE, when it opens: a `verify` over every tree it
 * covers, which is the one read of that kind this surface pays (`session.ts`,
 * `theRecord`). What it gets back is a level, and the badge in the corner states it for
 * the whole session. That statement was TIMELESS and it should never have been: it is
 * about the bytes the verdict was formed over, and the moment one more byte lands the
 * corner is asserting a level about a record that is no longer the one it read.
 *
 * MEASURED, AND IT IS WHY THIS FILE EXISTS. With a duplicate of the last entry appended
 * while the session was open — the break two writers appending at once used to leave —
 * the body of the page printed `seq gap: expected 8, found 7` and the corner, in the same
 * frame, said `fully-signed`. The surface disagreed with itself on one screen.
 *
 * WHAT IT MAY NOT DO IS RULE AGAIN, and that is the whole shape of it. Re-running
 * `verify` costs 54 ms over a small record and 1.7 s over a nine-megabyte one — linear in
 * the history — so a console that re-ruled on a clock would be a replay loop. What is
 * asked here is the CHEAP question the follower beside it already asks ten times a second
 * ({@link chainExtent}: one `readdir` per tail and one `stat` on that tail's last
 * segment, ~38 µs, and its cost is in the number of TAILS rather than of events). It opens
 * nothing and parses nothing.
 *
 * SO WHAT IT ANSWERS IS NARROW, AND THE NARROWNESS IS THE HONESTY. An extent that moved
 * means the record is no longer the one that was ruled on — it does NOT mean the record
 * broke, and this file may not claim it did. A freshness mark cannot see a rewrite that
 * preserves a size, and a probe that pretended otherwise would be offering a guarantee it
 * cannot keep (`chain/freshness.ts` says so about itself). The corner therefore stops
 * claiming a level about the whole record and says which record its level is about; the
 * verb that rules is one keystroke away, and the badge names it.
 *
 * IT LATCHES, and that is a decision rather than an optimisation. A verdict is formed at
 * an INSTANT; a later instant whose extent happens to match is not that instant, and a
 * corner that went back to asserting the level in full would be claiming coverage of the
 * entries that arrived in between. Latching is also what bounds the cost: once the answer
 * is no, nothing is asked of the disk again for the rest of the session.
 *
 * AND IT IS ITS OWN FILE RATHER THAN A FIELD OF THE FOLLOWER, which is worth the line
 * because the two ask the same question of the same disk on the same clock. They answer
 * DIFFERENT ones: the follower reports what somebody else appended and must not report a
 * duplicate of an entry it already showed as an arrival, which is why it filters by `seq`;
 * this reports that the verdict has stopped covering the record, which that same filter
 * makes invisible. Folding them would make one of the two wrong — the feed would show a
 * duplicate as news, which is the defect the filter is there to prevent. What that costs
 * is one more `chainExtent` per tick until this latches, measured and reported with the
 * delivery.
 */

import { type ChainExtent, chainExtent } from '@mnema/chain';

/** What a session that ruled on the record once can keep asking about that ruling. */
export interface TheProof {
  /**
   * Whether the verdict still covers the whole record — false from the first tick at
   * which any tree it covered has moved, and false for the rest of the session.
   *
   * It is a question and not a value because the answer changes under the caller, and it
   * is asked on the record's own clock and never on a frame: a redraw that asked would put
   * a `readdir` per tail on every keystroke, which is the cost the badge exists inside the
   * budget of (`tests/the-name-and-the-hints.test.ts` counts a frame's reads, and they are
   * none).
   */
  readonly coversTheWholeRecord: () => boolean;
}

/**
 * Watches the trees a verdict covered, from where they stand now.
 *
 * With no roots — a session opened outside any project — there is no verdict to hold and
 * nothing to watch, and the answer is that it covers everything there is: a corner that
 * degraded where there is no record would be naming a level nobody stated.
 */
export function watchingTheProof(roots: readonly string[]): TheProof {
  // READ BEFORE ANYTHING IS SERVED, in the same breath the verdict is taken, and for the
  // reason every reading of this mark takes: a mark taken afterwards would claim coverage
  // of an instant the verdict may not have reached. The direction of the error is the
  // cheap one — an append that lands DURING the opening's `verify` leaves a mark that
  // differs from it, so the badge degrades over an entry it may already have counted.
  const when = roots.map((root) => chainExtent({ root }));
  let moved = false;
  return {
    coversTheWholeRecord(): boolean {
      // LATCHED: nothing is asked of the disk once the answer is no.
      if (moved) return false;
      moved = roots.some((root, at) => chainExtent({ root }) !== (when[at] as ChainExtent));
      return !moved;
    },
  };
}
