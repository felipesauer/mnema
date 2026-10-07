/**
 * What a link may NOT end in: the one rule both write surfaces (`mnema link` and `link_knowledge`)
 * ask before anything is signed.
 *
 * `mnema link ADR-1 src/gen --rel refuses-a-write` used to be accepted, exit 0, and record the
 * text "ADR-1" as the subject of an edge pointing at nothing; the notice that said so came on the
 * fifth line, after the edge was already part of a chain that cannot be edited. A label that names
 * one decision is now turned into that decision's id before this is asked
 * (`label-as-address.ts`), so what reaches here still shaped like a label is one NO decision here
 * carries. It names nothing, and a link is refused rather than record it — on either end.
 *
 * It refuses only that. A subject or a target that is not a label is not required to resolve: a link
 * is legitimately cross-tree, and an address may name a path the tree does not hold yet.
 */

import { oneLine } from './one-line.js';

/** Whether a word has the shape of a decision label (`ADR-` and a number). */
export function isLabelShaped(word: string): boolean {
  return /^ADR-\d+$/i.test(word.trim());
}

/** The sentence that refuses a link, or `undefined` when neither end is a label left raw. */
export function linkRefusal(ends: {
  readonly subject: string;
  readonly target: string;
}): string | undefined {
  for (const end of [ends.subject, ends.target]) {
    if (isLabelShaped(end)) {
      return `"${oneLine(end)}" is a label no decision here carries, so it names nothing: a label is never recorded as an end of a link. Nothing was recorded.`;
    }
  }
  return undefined;
}
