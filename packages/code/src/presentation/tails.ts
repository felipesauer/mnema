/**
 * The tails a record holds: one line each, with the id whole and what a person
 * needs in order to decide whether to cut it.
 *
 * THE ID LEADS AND IT IS NOT SHORTENED, which is the one rule this report cannot
 * trade away: it is the argument `tail prune` takes, and a truncated one would make
 * the list useless for the only thing it is for. Everything else on the line is what
 * `prune` prints AFTER authorizing — how many events, through which head — moved to
 * where the information decides something, plus the tree it lives in (a waiver
 * follows the tail there) and whether a cut of it is already authorized.
 *
 * WHOSE TAIL IT IS is on the line for the reason the verb exists: the case `prune`
 * was built for is one person asking to be taken out of a record, and an id says
 * nothing about whose machine wrote it. It is the anchor the tail's LAST event
 * authorized as — see `TailStanding`, which decides that and is not re-decided here.
 *
 * THE STANDING IS SAID ON EVERY LINE, both ways round. A report that printed a word
 * only for the authorized ones would read as a list where nothing is authorized when
 * the reader is looking at a list where nothing has been LOOKED at, and the two are
 * not the same news. It says `no waiver` for the ordinary case so that `cut
 * authorized` is a difference the eye can find in a column.
 *
 * ONE LINE PER TAIL, and here that is free rather than defended: every field is a
 * hash, an id, a count or a word this file chose — none of it is prose an actor
 * wrote, so there is nothing to collapse with `oneLine` (contrast `provenance.ts`,
 * where a pattern's name is somebody's text).
 *
 * WITH NOTHING TO SHOW IT NAMES WHERE IT LOOKED. An empty list and a record with no
 * trees say the same nothing otherwise, and the reader who most needs this line is
 * the one who ran the verb in the wrong directory. It follows `prune`'s own refusal
 * (*"No tail X holds events in any tree here"*) and `verify`'s (*"no record here"*):
 * report what was searched, decide nothing on the reader's behalf.
 */

import type { HeldTail, Scope } from '@mnema/core';
import { asId, asScope, column, itemLine } from './items.js';
import type { Render } from './render.js';

/** The width the tree column is padded to, so the counts below it line up. */
const SCOPE_WIDTH = 7;

/** What a line says about the cut of the tail it names. */
const AUTHORIZED = 'cut authorized';
const NOT_AUTHORIZED = 'no waiver';

/** The lines `mnema tail list` prints. */
export function tailReport(
  render: Render,
  tails: readonly HeldTail[],
  trees: readonly Scope[],
): string[] {
  if (tails.length === 0) {
    return [`No tail holds events in any tree here — looked in ${trees.join(', ')}.`];
  }
  return [
    `${tails.length} tail(s):`,
    ...tails.map((held) =>
      render(
        itemLine([
          // The whole id, marked as what it is: a handle to copy into `tail prune`,
          // which is the one column of this list a reader does not read.
          asId(held.tail),
          asScope(column(held.scope, SCOPE_WIDTH)),
          `${held.standing.eventCount} event(s) through ${held.standing.throughHash}`,
          `the tail of ${held.standing.who}`,
          '·',
          held.authorized ? AUTHORIZED : NOT_AUTHORIZED,
        ]),
      ),
    ),
  ];
}
