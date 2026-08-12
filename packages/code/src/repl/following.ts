/**
 * FOLLOWING THE RECORD: asking, on a clock, whether anything moved — and reading only
 * what did.
 *
 * The console refuses every verb that writes, so nothing a caller types can move the
 * record. Everything this reports is therefore somebody ELSE's append: an agent working
 * through the other surface, a `mnema` command in another terminal, a merge that landed.
 * That is the whole feature — a reader watching a record they did not write.
 *
 * IT DOES NOT BREAK THE RULE THIS SURFACE IS BUILT ON, and the distinction is the
 * design. The rule is *nothing that redraws reads the record; the read is ONE, when the
 * session opens* (`session.ts`, and it is counted rather than promised in
 * `tests/the-name-and-the-hints.test.ts`). What is asked here is not a read: `chainExtent`
 * is one `readdir` per tail and one `stat` on that tail's last segment, and its cost is in
 * the number of TAILS rather than of events — a chain of one machine answers the same
 * whether it holds ten events or ten million (`chain/freshness.ts`). Measured on this
 * product's own record: 26 µs per question, against about 33 ms to redraw a page. A frame
 * is some twelve hundred of them.
 *
 * SO THE READ HAPPENS ONLY WHEN THE MARK MOVED, and then it reads WHAT GREW rather than
 * the tail. {@link readTailTip} walks a tail backwards — segments from last to first, and
 * lines from the end inside each one — and stops at the first entry it meets at or below
 * the seq already accounted for, so what it costs is the entries it hands back and not the
 * file they sit in. That is the same walk a writer resumes a tail with, and it is why this
 * costs the same on a chain of ten events and one of ten million.
 *
 * WHAT IT IS IN STEP WITH IS READ BEFORE THE READING, never after, and the asymmetry is
 * deliberate: an append that lands WHILE the tails are being read is either picked up (and
 * the mark remembered is the older one, so the next question reads again and finds nothing
 * new) or missed (and the mark remembered is the older one, so the next question finds it).
 * Recording the mark afterwards would be claiming coverage of a moment the read may not
 * have reached, which is the expensive error wearing the cheap one's clothes. The MCP
 * server's warm caches take the same reading for the same reason (`mcp/cache-registry.ts`).
 *
 * WHERE IT STARTS FROM is the tail as it stands when the session opens: one entry per
 * tail, taken off the END of the tail, which is a declared read and a bounded one — a
 * line per tail, whatever the record weighs. Anything appended before that instant is
 * the record the session opened over; anything after it is an occurrence, and a caller
 * sees it.
 *
 * ONLY THIS PROJECT'S TREES. What it follows is what the opening's `verify` covered —
 * the committed tree and this machine's private one — and never another project of the
 * workspace: a read that spans projects is a full replay of each, which is a cost of a
 * different order, and doing it on a clock would be worse.
 *
 * AND IT RULES ON NOTHING. Two equal extents mean "nothing observable moved", never
 * "the chain is intact" — a rewrite that preserves a file's size moves no mark, and
 * tampering is `verify`'s subject, which recomputes hashes and checks signatures. The
 * badge in the corner says what the record proved when the session opened, and the word
 * that asks again is one keystroke away at the prompt.
 */

import {
  type CatalogEvent,
  type ChainExtent,
  type ChainLayout,
  catalogUpcasters,
  chainExtent,
  type Entry,
  listTails,
  readTailTip,
  type UpcasterRegistry,
} from '@mnema/chain';

/**
 * The seq of a tail nothing has been accounted for on.
 *
 * Below every seq a chain can hold — they run contiguously from zero — so a tail that
 * APPEARS while a session is open (another machine's first append, a merge that brought
 * a tail in) has every one of its entries read as new, which is what they are to a reader
 * who was watching when it arrived.
 */
const NOTHING_ACCOUNTED = -1;

/**
 * The seq to ask the tip for when what is wanted is THE LAST ENTRY and nothing else.
 *
 * The walk stops at the first entry at or below the seq it is given, so a seq no event
 * can hold stops it at the first entry it meets — which, walking from the end, is the
 * tail's last. One line, off the end of the file, whatever the history weighs.
 */
const THE_LAST_ENTRY = Number.MAX_SAFE_INTEGER;

/** One tree of the record, followed: where its chain is, and how far this is in step. */
interface Followed {
  readonly layout: ChainLayout;
  /**
   * How far the chain reached when this was last in step with it. Opaque: compared with
   * `!==` and nothing else, because the shape is the probe's business.
   */
  extent: ChainExtent;
  /** The seq of the last entry accounted for, per tail of this tree. */
  readonly accounted: Map<string, number>;
}

/** What a session watching the record can ask. */
export interface Following {
  /**
   * Everything appended since this was last asked, oldest first within each tail.
   *
   * Empty is the ordinary answer and it costs the question alone. There is no order
   * ACROSS tails and none is invented here: within a tail `seq` is the proven order and
   * is never reordered, and between tails the record's own merge picks a convention that
   * only a full replay can apply (`core`, `projections/order.ts`). What arrives together
   * arrives grouped by the tail that wrote it.
   */
  readonly whatHappened: () => readonly CatalogEvent[];
}

/**
 * Follows the trees at `roots` from where they stand now.
 *
 * With no roots — a session opened outside any project — nothing is read, nothing is
 * asked, and every question answers empty: there is no record to follow and no cost to
 * pay for one.
 */
export function followingTheRecord(roots: readonly string[]): Following {
  // One registry for the whole session, like the warm caches keep: the catalog is the
  // same for every tree, and building it per read was pure waste where that was measured.
  const upcasters: UpcasterRegistry = catalogUpcasters();
  const trees: Followed[] = roots.map((root) => {
    const layout: ChainLayout = { root };
    // THE MARK FIRST, then where each tail stands — for the reason every reading here
    // takes: a mark taken after the tails were read would claim coverage of an instant
    // the reading may not have reached.
    const extent = chainExtent(layout);
    const accounted = new Map<string, number>();
    for (const tail of listTails(layout)) {
      accounted.set(tail, lastAccounted(layout, tail, upcasters, NOTHING_ACCOUNTED));
    }
    return { layout, extent, accounted };
  });

  return {
    whatHappened(): readonly CatalogEvent[] {
      const happened: CatalogEvent[] = [];
      for (const tree of trees) {
        const extent = chainExtent(tree.layout);
        // NOTHING MOVED, AND THAT IS THE ANSWER MOST OF THE TIME. No tail is opened, no
        // line is parsed, and what it cost is the question.
        if (extent === tree.extent) continue;
        for (const tail of listTails(tree.layout)) {
          const accounted = tree.accounted.get(tail) ?? NOTHING_ACCOUNTED;
          // The boundary entry the walk stops on is at or below what is accounted for,
          // and it is the one entry the tip may hold that is not new — the walk's own
          // doc says a caller that wants strictly-above filters, so this one does.
          const grown = readTailTip(tree.layout, tail, upcasters, accounted).filter(
            (entry: Entry) => entry.link.seq > accounted,
          );
          if (grown.length === 0) continue;
          tree.accounted.set(tail, grown[grown.length - 1]?.link.seq ?? accounted);
          for (const entry of grown) happened.push(entry.event);
        }
        tree.extent = extent;
      }
      return happened;
    },
  };
}

/**
 * The seq of the last entry of a tail, or {@link NOTHING_ACCOUNTED} when it holds none.
 *
 * A tail directory with no entry in it is a real state — the writer creates it, and its
 * proof of ownership, before the first append lands — and it is the same answer a tail
 * nobody has seen before gets: everything it ever holds is new.
 */
function lastAccounted(
  layout: ChainLayout,
  tail: string,
  upcasters: UpcasterRegistry,
  none: number,
): number {
  return readTailTip(layout, tail, upcasters, THE_LAST_ENTRY).at(-1)?.link.seq ?? none;
}
