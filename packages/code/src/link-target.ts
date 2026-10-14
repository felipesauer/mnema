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

import { ADDRESS_RELATIONS } from '@mnema/core';
import { addressLiesOutside } from './governed-tree.js';
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

/**
 * The sentence that refuses a link whose target is a path OUTSIDE the project, or `undefined` when
 * it is not one. Asked only of a link born in the public tree, which is committed and reaches every
 * clone: an address no clone can resolve is the one thing that tree must not carry. The private and
 * global trees stay on one machine and are not asked.
 *
 * Only a relation that carries an ADDRESS is asked (`ADDRESS_RELATIONS`): `derived-from` cites the
 * file a proposal was read out of, which may legitimately be a name no clone can open, and covers
 * no region. Only a target shaped like a path is asked at all: an id has no `/` in it. "Outside" is
 * the one idea the gates use (`addressLiesOutside`).
 */
export function outsideTheProject(rel: string, target: string, root: string): string | undefined {
  if (!(ADDRESS_RELATIONS as readonly string[]).includes(rel)) return undefined;
  if (!target.includes('/') && target !== '..') return undefined;
  if (!addressLiesOutside(target, root)) return undefined;
  return `"${oneLine(target)}" is outside this project, and a link in the public tree reaches every clone, none of which can open that path. Link a path inside the project, or record the link with --scope private. Nothing was recorded.`;
}
