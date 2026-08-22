/**
 * The rule itself: that "newest first" points the way it claims to, asked of the
 * exported comparison over ids the PRODUCT minted.
 *
 * `one-rule-for-newest-first.test.ts` proves the comparison is written in one place.
 * That is the half a source scan can prove, and it is not the half that was wrong:
 * six sites agreed with each other and were all wrong together. So the direction is
 * pinned here, on real minted ids — a hand-written pair of literals could be ordered
 * the way an assertion wants for reasons `mintId` does not produce.
 */

import { describe, expect, it } from 'vitest';
import { mintId } from '../identity/id.js';
import { newestFirst } from './newest-first.js';

describe('newestFirst', () => {
  it('serves the NEWER of two ids minted in one millisecond first', () => {
    // What the scan cannot say. Two ids from one burst share their millisecond, so
    // they land on the tie-break, and the second minted is the one that must come out
    // in front. Real minted ids and not literals: a hand-written pair could be ordered
    // the way the assertion wants for reasons the product does not produce.
    //
    // The pair is SOUGHT rather than assumed. Two consecutive mints share a
    // millisecond about 99.3% of the time, and the first draft of this case simply
    // asserted that they had — which made it a case that goes red one run in 150 for
    // no defect at all, which is the shape of flake this whole slice exists to remove.
    const pairInOneMillisecond = (): readonly [string, string] => {
      for (let tries = 0; tries < 1000; tries += 1) {
        const first = mintId();
        const second = mintId();
        if (first.slice(0, 13) === second.slice(0, 13)) return [first, second];
      }
      throw new Error('no two consecutive mints landed in one millisecond in 1000 tries');
    };
    const [older, newer] = pairInOneMillisecond();

    const at = '2026-08-22T12:00:00.000Z';
    const pair = [
      { at, id: older },
      { at, id: newer },
    ];
    expect([...pair].sort(newestFirst).map((each) => each.id)).toEqual([newer, older]);
    expect(
      [...pair]
        .reverse()
        .sort(newestFirst)
        .map((each) => each.id),
    ).toEqual([newer, older]);
  });

  it('puts the instant above the id — a newer id does not outrank an older instant', () => {
    // The clause order, which the tie-break case cannot see. Reversing the two would
    // still break ties the right way and would order the whole list by id.
    const earlier = { at: '2026-08-22T12:00:00.000Z', id: mintId() };
    const later = { at: '2026-08-22T12:00:01.000Z', id: mintId() };
    expect([earlier, later].sort(newestFirst)).toEqual([later, earlier]);
    // And again with the ids the other way round, so the pass cannot come from them.
    const swapped = [
      { at: earlier.at, id: later.id },
      { at: later.at, id: earlier.id },
    ];
    expect(swapped.sort(newestFirst).map((each) => each.at)).toEqual([later.at, earlier.at]);
  });
});
