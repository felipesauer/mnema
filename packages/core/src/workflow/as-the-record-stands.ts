/**
 * Deciding on the record and appending what was decided, as one act against every
 * other session of this installation.
 *
 * THE DEFECT THIS CLOSES is a read-modify-write one level above the tail's. The
 * writer already holds the tail's lock across reading its END and appending to it,
 * so two sessions can no longer write one `seq` twice. But a gated write reads more
 * than the end: it replays the record to learn what state a decision is in, judges
 * the move against that state, and only then appends — and the replay ran before
 * the lock was taken. Measured on the built binary, on a `proposed` decision:
 * `mnema decision move accept` and `… reject` run together both exited 0 in 19 of
 * 20 rounds, the record held two transitions out of `proposed`, `verify` passed,
 * and `show` called the decision accepted while listing both notes — a rejected
 * decision the governance would count in force, past a gate that declares
 * `rejected` terminal. Two concurrent `decision record` minted the same `ADR-<n>`
 * in 10 of 10 pairs, for the same reason: the count was read outside the lock.
 *
 * ## Read first, then check under the lock that nothing moved
 *
 * Replaying the whole record INSIDE the lock is the obvious fix and the expensive
 * one: the replay is most of what a write costs on a command line that holds nothing
 * (one `decision move accept`, measured with the order alternated: about 0.28 s at
 * 1 thousand events, 0.67 s at 10 thousand, 1.7 s at 30 thousand, 3.8 s at 100
 * thousand), the lock's wait budget is 2 s, and a holder that replays makes every
 * waiter pay for it. So the record is read as before,
 * outside the lock, with the chain's extent taken first ({@link chainExtent}: one
 * `readdir` per tail and one `stat` on each tail's last segment). Under the lock
 * the extent is taken again. Equal, nothing was appended anywhere in this tree
 * since the read began, so what was judged is what the record says and the write
 * goes ahead with no second read. Different, the record is read again, under the
 * lock, and judged again against what it says NOW — the only case that pays twice,
 * and only when another write landed in between.
 *
 * WHAT THE SECOND READING COSTS, measured: a move alone costs what it cost before
 * (the same medians at 1, 10, 30 and 100 thousand events), but a move that finds
 * the chain moved holds the lock for a whole replay — 0.10 s at 10 thousand events,
 * 0.36 s at 30 thousand, 1.35 s at 100 thousand, in process — and a third session
 * waiting behind two such holds can run out of the lock's 2 s: measured on the
 * binary, three moves of three different decisions at once refused one of them
 * `TAIL_BUSY` in 1 of 3 tries at 50 thousand events and in 3 of 3 at 75 and at 100
 * thousand (none at 30 thousand), where the code before this let all three through;
 * two at once never ran out. That is the price of this order, and the
 * choice about it is not this file's.
 *
 * The judgement is handed the earlier reading alongside the new one, so a move
 * whose subject changed under it can say so in words of its own
 * ({@link stateMoved}) instead of the gate's: a person who asked to reject a
 * proposed decision and is told "accepted cannot be rejected" was not told that
 * somebody accepted it a moment ago.
 *
 * ## What it does not cover
 *
 * The lock is the TAIL's, so it binds the sessions that share one: one key, one
 * installation, one tree — which is every case measured (two windows, a command
 * line beside an agent). Two keys writing one tree on one machine take two locks;
 * the extent still catches a write of the other that landed before this one's
 * lock, but not one that lands after. Between machines nothing coordinates at all,
 * and two moves out of one state are inherent there; that case is not prevented,
 * it is SAID, by the reading that finds it (`divergentMoves`).
 */

import { type ChainLayout, type ChainWriter, chainExtent } from '@mnema/chain';
import { oneLine } from '../one-line.js';

/** What a judgement of the record came to: refuse with this, or write with this. */
export type Judged<R> = { readonly refuse: R } | { readonly write: () => R };

/** What {@link onTheRecordAsItStands} needs from a write context. */
export interface RecordAndWriter {
  readonly writer: ChainWriter;
  readonly layout: ChainLayout;
}

/**
 * Reads the record, judges it, and — if the judgement is to write — writes under the
 * tail's lock, against the record as it stands at that moment rather than as it stood
 * when it was read.
 *
 * `judge` is called once on the first reading, with `earlier` undefined. A refusal
 * there is returned without taking the lock. Otherwise the lock is taken, and if the
 * chain moved since the first reading began, `judge` is called again on a second
 * reading taken under the lock, with the first as `earlier`; whatever it comes to is
 * the answer. `write` runs only under the lock, and only from the judgement of the
 * reading the lock vouches for.
 *
 * `read` must read the record from the chain — never from a cache that could be older
 * than the extent this takes.
 */
export function onTheRecordAsItStands<V, R>(
  ctx: RecordAndWriter,
  read: () => V,
  judge: (view: V, earlier: V | undefined) => Judged<R>,
): R {
  const extent = chainExtent(ctx.layout);
  const first = read();
  const verdict = judge(first, undefined);
  if ('refuse' in verdict) return verdict.refuse;
  return ctx.writer.exclusively(() => {
    if (chainExtent(ctx.layout) === extent) return verdict.write();
    const again = judge(read(), first);
    return 'refuse' in again ? again.refuse : again.write();
  });
}

/**
 * The refusal of a move whose subject changed state between the reading it was judged
 * on and the moment it would have been appended: another write moved it first.
 *
 * Its own code, NOT the gate's, because the caller's next move differs. A gate refusal
 * says the move is illegal from where the subject stands; this says the subject did not
 * stand where the caller saw it, and names where it stands now — which is what to read
 * before asking again.
 */
export interface StateMovedErr {
  readonly ok: false;
  readonly code: 'STATE_MOVED';
  readonly message: string;
}

/**
 * Builds {@link StateMovedErr}: `noun` is the kind of subject (`decision`, `task`,
 * `skill`, `run`), `asked` the move that was refused, `was` and `now` the two states.
 *
 * The two states came out of the record and a task's move is the caller's own word, read
 * before the gate has judged it, so all three go through {@link oneLine} with the id.
 */
export function stateMoved(
  noun: string,
  id: string,
  asked: string,
  was: string,
  now: string,
): StateMovedErr {
  return {
    ok: false,
    code: 'STATE_MOVED',
    message:
      `${noun} "${oneLine(id)}" was ${oneLine(was)} when this ${oneLine(asked)} was asked and is ${oneLine(now)} now: ` +
      'another write moved it first. This move was not appended.',
  };
}
