/**
 * How far a chain reaches on disk, as one comparable value — the question
 * "might this chain have grown since I last read it?" answered without reading
 * it.
 *
 * A reader that RETAINS a replay (the MCP server's warm projection caches) has
 * to know when the replay stopped being the chain. The obvious signals are the
 * wrong ones: a timer expires a projection that is still correct, and an `mtime`
 * is a weaker signal for the same cost — it depends on clock granularity, so two
 * appends inside one tick can leave the mark a reader remembers unchanged.
 *
 * The right signal comes from the chain's own shape. A chain is append-only, so
 * every event MAKES A FILE BIGGER: an extent that pairs each tail with its last
 * segment and that segment's size is monotone under the only operation the
 * writer performs. And only the LAST segment can grow — the ones before it were
 * sealed by a rotation and are never opened again — so the whole of a tail's
 * growth is visible in one `stat`, whatever the history weighs. Three things can
 * therefore change it, and they are exactly the three ways a chain moves:
 *
 *   - a tail APPENDS (its last segment gets bigger),
 *   - a tail ROTATES (the last segment becomes a later one),
 *   - a tail APPEARS or vanishes (another machine, or another installation of
 *     the same key, writes into this tree for the first time).
 *
 * The enumeration is the replay's own — {@link listTails} and
 * {@link orderedSegments}, the same two functions the projection reads through.
 * That is not a convenience: it is what makes "the extent watches what the
 * replay reads" a property of the code rather than a claim, so a file the replay
 * starts reading cannot be one the extent quietly ignores.
 *
 * WHAT IT DOES NOT SEE, and must not: a rewrite that preserves the size, and any
 * edit to a segment already sealed. Both are tampering, and tampering is
 * {@link verifyChain}'s subject — it recomputes hashes and checks signatures,
 * which is the only honest way to answer it. A freshness probe that pretended to
 * detect tampering would be offering a guarantee it cannot keep, on a signal
 * chosen for being cheap.
 *
 * It is also not a checkpoint of anything: two equal extents mean "nothing
 * observable moved", never "the chain is intact".
 */

import { statSync } from 'node:fs';
import { basename } from 'node:path';

import type { ChainLayout } from './layout.js';
import { listTails, orderedSegments } from './store.js';

/**
 * An opaque mark of how far a chain reaches on disk. Compare two of them with
 * `!==` and nothing else — the shape is this module's business, and a caller
 * that parsed it would be depending on a format that exists only to be
 * different when the chain is.
 */
export type ChainExtent = string;

/**
 * Reads a chain's extent: one `readdir` per tail plus one `stat` on each tail's
 * last segment, and nothing else. The cost is in the number of TAILS — a chain
 * of one machine costs the same whether it holds ten events or ten million.
 *
 * An empty string is the honest extent of a tree that has no tails yet: it has
 * nothing to read, and it stops being empty the moment it does.
 *
 * A tail that cannot be listed or stat'ed does not throw. It contributes a mark
 * naming the error instead, which keeps the extent DETERMINISTIC while the fault
 * lasts: a reader does not rebuild in a loop against a directory it cannot read,
 * and it does rebuild the moment the fault clears or the tail goes away, because
 * either changes the mark. The replay is what reports an unreadable chain, and
 * it reports it by failing — that answer belongs to the read, not to a probe
 * that was only ever asked whether anything moved.
 */
export function chainExtent(layout: ChainLayout): ChainExtent {
  let tails: readonly string[];
  try {
    tails = listTails(layout);
  } catch (error) {
    return `!${errorCode(error)}`;
  }
  return tails.map((tail) => `${tail}=${tailExtent(layout, tail)}`).join('|');
}

/** One tail's reach: its last segment file and that file's size. */
function tailExtent(layout: ChainLayout, tailId: string): string {
  try {
    const last = orderedSegments(layout, tailId).at(-1);
    // A tail directory with no segment yet: the writer creates it (and its proof
    // of ownership) before the first append lands. Distinct from every extent a
    // written tail can have, so the first event still moves the mark.
    if (last === undefined) return '-';
    return `${basename(last)}:${statSync(last).size}`;
  } catch (error) {
    return `!${errorCode(error)}`;
  }
}

/** The errno of a failed read, or a fixed stand-in — the mark has to be stable. */
function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : 'UNREADABLE';
}
