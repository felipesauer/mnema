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
 * IT COUNTS THE TAILS THAT HOLD EVENTS, AND SAYS SO ON ITS FIRST LINE. A tail with none — an
 * installation that proved it owns a tail and never wrote to it — is not listed, on purpose: there
 * is nothing in it a cut could remove, and `prune` refuses a tail without events. `mnema verify`
 * and `mnema witness` count that tail, because it is a tail the record holds, so over the same
 * record the two numbers can differ by it. The first line names what this one counts, so the
 * difference reads as two questions and not as two answers to one
 * (`the-witness-counts-the-tails-verify-counts.test.ts`, "tail list says it counts the tails
 * holding events").
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

/**
 * What a reading of the tails says when none holds an event: the trees it read, or — when it read
 * none — why.
 *
 * ONE SENTENCE FOR THE THREE PLACES THAT SAY IT (`tail list`, `witness`, `witness upgrade`), which
 * wrote it three times. And the list can be empty: the witness paths leave this machine's global
 * tree out unless `--global` asks for it, so outside a project there is no tree left to read, and
 * the three copies said `looked in .` — a list with no items and a full stop. Measured on the
 * binary, and now said: there is no project here, and `--global` is what reads the one tree there
 * is (`outside-a-project-the-surface-says-so.test.ts`).
 */
export function noTailHoldsEvents(trees: readonly Scope[]): string {
  return trees.length === 0
    ? 'No tail holds events here: this is not a mnema project, and this machine’s global tree is read only with --global.'
    : `No tail holds events in any tree here — looked in ${trees.join(', ')}.`;
}

/** The lines `mnema tail list` prints. */
export function tailReport(
  render: Render,
  tails: readonly HeldTail[],
  trees: readonly Scope[],
): string[] {
  if (tails.length === 0) return [noTailHoldsEvents(trees)];
  return [
    `${tails.length} tail(s) holding events — the ones a cut can name:`,
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
