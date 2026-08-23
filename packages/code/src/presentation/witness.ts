/**
 * Where the external witness stands, one line per tail.
 *
 * THE STATUS IS SAID ON EVERY LINE, both ways round, for the reason the tails report
 * says the standing on every line: a report that printed a word only for the
 * witnessed ones would read as "nothing is witnessed" when the reader is looking at a
 * list of tails nobody has asked about, and those are not the same news.
 *
 * PENDING IS A WORD OF ITS OWN and it is spelled in capitals. It is the state a
 * person is in at the moment they are most likely to believe they are finished — the
 * request went through — and a list that showed it the way it shows coverage would be
 * the one place this layer could quietly become a promise.
 *
 * THE CHECKPOINT DIGEST IS ON THE LINE, whole, because it is the name the attestation
 * is filed under and the value a stranger checks the `.ots` against with somebody
 * else's client. Shortening it would leave the reader with a form nothing accepts.
 *
 * ONE LINE PER TAIL, and it is free here: every field is a hash, a word of a closed
 * union or a sentence this package composed — except the detail of a reading, which
 * can quote a calendar URI read off a file in the tree, and that value goes through
 * the chain's own one-line rule before it ever reaches here (see `witness.ts`).
 */

import type { WitnessReading } from '@mnema/chain';
import type { Scope } from '@mnema/core';
import { asId, asScope, asWord, column, itemLine } from './items.js';
import type { Render } from './render.js';

/** The width the tree column is padded to, so what follows it lines up. */
const SCOPE_WIDTH = 7;

/**
 * What each of the three states READS — TOTAL over the union, so a state added to it
 * does not compile until it has a word.
 *
 * ONE TABLE AND TWO CALLERS. The listing puts it in a column and the two acts put it
 * in a sentence, and they said it differently until this was a function: the verdict
 * shouted `PENDING` while `mnema witness stamp` — the one moment somebody is most
 * likely to think they are finished — printed a lowercase `pending` beside it. Two
 * readings of one word is the shape that produces exactly that.
 */
const SAID: Readonly<Record<WitnessReading['status'], string>> = {
  'not-covered': 'not covered',
  pending: 'PENDING',
  covered: 'covered',
};

/** How one witness state reads, wherever this surface says it. */
export function witnessWord(status: WitnessReading['status']): string {
  return SAID[status];
}

/** One tail's standing, as this report takes it. */
export interface WitnessLine {
  readonly scope: Scope;
  readonly tail: string;
  readonly checkpoint: string | null;
  readonly reading: WitnessReading;
}

/** The lines `mnema witness` prints. */
export function witnessReport(
  render: Render,
  lines: readonly WitnessLine[],
  trees: readonly Scope[],
): string[] {
  if (lines.length === 0) {
    return [`No tail holds events in any tree here — looked in ${trees.join(', ')}.`];
  }
  return [
    `${lines.length} tail(s):`,
    ...lines.map((line) =>
      render(
        itemLine([
          asId(line.tail),
          asScope(column(line.scope, SCOPE_WIDTH)),
          asWord(witnessWord(line.reading.status)),
          '·',
          line.checkpoint === null ? 'no checkpoint' : `checkpoint ${line.checkpoint}`,
          '·',
          line.reading.detail,
        ]),
      ),
    ),
  ];
}
