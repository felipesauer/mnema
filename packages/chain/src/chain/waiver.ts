/**
 * The waiver: what a `tail.pruned` claims about the disk, checked while the disk
 * can still answer.
 *
 * A tail that is simply gone leaves the verifier with nothing to say beyond an
 * ambiguity — measured on a real 402-event tail, deleting it whole produced ZERO
 * findings and the sentence `1 tail(s); no events yet`, which is also what a tail
 * that never wrote anything gets. The census note for the orphaned public key
 * already listed the three readings of that ("dropped by a botched merge, never
 * written, or removed") and the disk held nothing to choose between them. A waiver
 * is the fact that answers the third one, and only it.
 *
 * THREE READERS, ONE READING OF THE DISK. {@link tailStanding} is asked by the
 * operation that BUILDS a waiver (to fill in what it claims) and by the door that
 * ACCEPTS one (to check the claim); {@link standingOf} is the same rule, asked by
 * the reading that ENUMERATES the tails of a tree with the entries already in hand.
 * Written as separate readings, the day one of them counted a torn final line
 * differently from the others would be the day an honest waiver started being
 * refused — or a lying one accepted, or a listed tail said to hold a count the
 * verb that cuts it disagrees with.
 *
 * WHY THE CHECK IS THE WRITER'S AND NEVER THE READER'S. The waiver exists to
 * survive the cut it authorizes, so a moment after it is honest, the tail it names
 * is gone. A reader applying this rule would refuse the waiver from then on — and
 * refusing one line refuses the whole tail it lives on, forever, on an append-only
 * log. The reader's rule is the SHAPE of the payload (see parse.ts); this is the
 * writer's, and the asymmetry is the point rather than an oversight.
 *
 * WHAT A WAIVER IS NOT: permission. Anyone who can write to a record can declare a
 * prune of any tail in it, exactly as anyone who can write can record any other
 * fact. The declaration is signed and attributed, so a forged one is a fact that
 * points at whoever forged it — which is the same posture the gates take ("they
 * protect the shape, not the contents; it is not access control").
 */

import type { CatalogEvent } from '../events/catalog.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import type { Entry } from './entry.js';
import { type ChainLayout, tailFingerprint } from './layout.js';
import { readTail } from './store.js';

/** What the disk says about one tail right now: how it ends, how much it holds, whose it is. */
export interface TailStanding {
  /** The hash of the tail's last entry — the head a waiver names. */
  readonly throughHash: string;
  /** How many entries the tail holds. */
  readonly eventCount: number;
  /**
   * The anchor the tail's LAST event authorized as — whose tail this is, and the
   * subject a waiver over it carries.
   *
   * The last rather than the first, because a waiver is written at the moment of the
   * cut and the anchor a tail speaks for is a thing that can move: an installation
   * that enrolls into another identity keeps writing to the same tail under a new
   * `who`. What the record can say without qualification is which anchor the tail
   * served when it was cut, so that is what it says.
   */
  readonly who: string;
}

/**
 * What the disk says about `tailId`, or undefined when there is nothing to say —
 * the tail is absent, or it holds no entry at all.
 *
 * AN EMPTY TAIL ANSWERS UNDEFINED, and that is a decision rather than a fallout of
 * the shape. A tail directory with a `tailproof.json` and zero events is the NORMAL
 * residue of a session that only READ: the writer mints its proof in its
 * constructor, and opening a write context to read the anchor is enough to leave
 * one behind. There is nothing to account for in cutting it — no event was lost —
 * and a waiver over it would put "pruned under authorization" on the census note of
 * the most innocent state there is.
 */
export function tailStanding(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
): TailStanding | undefined {
  return standingOf(readTail(layout, tailId, upcasters).entries);
}

/**
 * The same reading, over entries a caller ALREADY HAS — the rule itself, with the
 * disk access left to {@link tailStanding}.
 *
 * It exists for the reader that takes a whole TREE at once: listing what every tail
 * of a tree holds needs each tail's entries anyway (the waivers in it are found by
 * {@link tailWaiversIn}, which takes exactly those entries), and asking
 * {@link tailStanding} on top of that would read every tail a second time. Two
 * readings of one tail is what this module's header refuses, and it refuses it here
 * for the narrower reason too: the second read happens later, so a tail appended to
 * in between would have its standing counted against entries nobody looked at.
 *
 * Everything the standing MEANS is stated on {@link TailStanding} — including why
 * the anchor is the last entry's and not the first's. Nothing is decided here that
 * was not decided there.
 */
export function standingOf(entries: readonly Entry[]): TailStanding | undefined {
  const last = entries.at(-1);
  if (last === undefined) return undefined;
  return { throughHash: last.link.hash, eventCount: entries.length, who: last.event.who };
}

/**
 * Why this event must not be sealed onto `ownTail`, or undefined when it may be.
 *
 * Non-waivers pass straight through: this is asked of every append, so it answers
 * for the whole catalog and refuses only the one kind it is about.
 *
 * The four refusals, and what each closes:
 *   - a waiver naming the tail it is being written to. The waiver has to outlive the
 *     cut, and one written into the tail being cut goes with it. It is also the one
 *     mistake that is easy to make by accident, since the writer's own tail is the
 *     one always at hand.
 *   - a waiver naming a tail with nothing on disk to check. Accepted, it would be a
 *     signature over an unfalsifiable claim — which is exactly what a waiver
 *     accepted AFTER the cut would be.
 *   - a head hash that disagrees with the tail's last entry.
 *   - a count that disagrees with the tail's length.
 *   - a subject that is not the anchor that tail served.
 *
 * The middle two are what turn the waiver from a declaration into evidence: the
 * census note it later explains quotes both, and a reader who kept a copy of the
 * tail can hold the copy against them. The last one keeps the fact filed under the
 * identity it is about, which is the whole reason the subject is an anchor: a
 * person is an anchor, and their tails are the unit of the cut.
 */
export function unprovenWaiverReason(input: {
  layout: ChainLayout;
  upcasters: UpcasterRegistry;
  event: CatalogEvent;
  /** The tail this append is landing on. */
  ownTail: string;
}): string | undefined {
  const { layout, upcasters, event, ownTail } = input;
  if (event.kind !== 'tail.pruned') return undefined;
  const claim = event.payload;
  if (claim.tail === ownTail) {
    return `a waiver cannot name the tail it is written to (${ownTail}) — it would be cut with it`;
  }
  const standing = tailStanding(layout, claim.tail, upcasters);
  if (standing === undefined) {
    return `no tail ${claim.tail} holds events in this chain — a waiver is written BEFORE the cut, while its claims can still be checked`;
  }
  if (standing.throughHash !== claim.throughHash) {
    return `tail ${claim.tail} ends at ${standing.throughHash}, not at the claimed ${claim.throughHash}`;
  }
  if (standing.eventCount !== claim.eventCount) {
    return `tail ${claim.tail} holds ${standing.eventCount} event(s), not the claimed ${claim.eventCount}`;
  }
  if (standing.who !== event.subject) {
    return `tail ${claim.tail} served ${standing.who}, not the named subject ${event.subject}`;
  }
  return undefined;
}

/** A waiver found in the record: what it claims, and who signed the claim. */
export interface TailWaiver {
  /** The tail it authorizes the cut of. */
  readonly tail: string;
  /** The head hash that tail had when the waiver was written. */
  readonly throughHash: string;
  /** How many events it held then. */
  readonly eventCount: number;
  /** Why it was cut, as recorded. */
  readonly reason: string;
  /** The anchor that authorized it — the waiver event's own `who`. */
  readonly who: string;
  /** The tail the waiver itself lives on, which is never {@link TailWaiver.tail}. */
  readonly declaredOn: string;
}

/**
 * Every waiver the tails present in this chain hold.
 *
 * It reads what the verifier has ALREADY read, rather than opening anything: the
 * entries of every tail are in hand by the time the census is taken, and a second
 * pass over the disk to find a handful of lines would be a second reading of the record
 * that could disagree with the first.
 *
 * A waiver about a tail that is still HERE is collected like any other and simply
 * never consulted — the census only asks about keys with no tail at all. That is
 * what keeps a waiver from ever curing a break: a present, corrupt tail is verified
 * exactly as it always was, waiver or no waiver.
 */
export function tailWaiversIn(entriesByTail: ReadonlyMap<string, readonly Entry[]>): TailWaiver[] {
  const waivers: TailWaiver[] = [];
  for (const [declaredOn, entries] of entriesByTail) {
    for (const entry of entries) {
      const waiver = entry.event;
      if (waiver.kind !== 'tail.pruned') continue;
      waivers.push({
        tail: waiver.payload.tail,
        throughHash: waiver.payload.throughHash,
        eventCount: waiver.payload.eventCount,
        reason: waiver.payload.reason,
        who: waiver.who,
        declaredOn,
      });
    }
  }
  return waivers;
}

/**
 * The waivers that account for a committed key having no tail — those naming a tail
 * whose fingerprint prefix is that key.
 *
 * The match is by FINGERPRINT and not by tail id, because the census note is about
 * a KEY: one key can own several tails (several installations of it), and the note
 * only ever appears when NONE of them is present. A waiver for any one of them is
 * part of the account of why the key stands alone.
 *
 * The order is the order the tails were read in, which is the sorted tail order the
 * store lists — so a note over two waivers reads the same on every machine.
 */
export function waiversForKey(
  fingerprint: string,
  waivers: readonly TailWaiver[],
): readonly TailWaiver[] {
  return waivers.filter((waiver) => tailFingerprint(waiver.tail) === fingerprint);
}
