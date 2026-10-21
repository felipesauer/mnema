/**
 * What a link may NOT end in: the one rule both write surfaces (`mnema link` and `link_knowledge`)
 * ask before anything is signed.
 *
 * `mnema link ADR-1 src/gen --rel refuses-a-write` used to be accepted, exit 0, and record the
 * text "ADR-1" as the subject of an edge pointing at nothing; the notice that said so came on the
 * fifth line, after the edge was already part of a chain that cannot be edited. A label that names
 * one decision is now turned into that decision's id before this is asked
 * (`label-as-address.ts`), so what reaches here still shaped like a label is one NO decision here
 * carries. It names nothing, and a link is refused rather than record it: on either end.
 *
 * It refuses only that. A subject or a target that is not a label is not required to resolve: a link
 * is legitimately cross-tree, and an address may name a path the tree does not hold yet.
 */

import { dirname, isAbsolute } from 'node:path';
import type { UpcasterRegistry } from '@mnema/chain';
import { DERIVED_FROM_RELATION } from '@mnema/chain';
import type { RecordedAs } from '@mnema/context';
import { ADDRESS_RELATIONS, locateLinkScope, type ResolvedTrees, type Scope } from '@mnema/core';
import { addressLiesOutside, addressRelativeToRoot } from './governed-tree.js';
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
 * The relations whose target is asked whether it lies inside the project: the ones that carry an
 * ADDRESS, and `derived-from`, which cites the file a proposal was read out of. A file outside the
 * project is a name no clone can open and no reading of this project can follow, whichever tree
 * the link is written to.
 */
const RELATIONS_THAT_NAME_A_PATH: readonly string[] = [...ADDRESS_RELATIONS, DERIVED_FROM_RELATION];

/**
 * The sentence that refuses a link whose target is a path OUTSIDE the project, or `undefined` when
 * it is not one. Asked of a link in EVERY tree: the public tree reaches every clone, none of which
 * can open the path, and the private and global trees (this machine's own) would hold an address
 * that covers nothing here and a citation no one can follow, which the record cannot take back.
 *
 * Only a relation that names a path is asked ({@link RELATIONS_THAT_NAME_A_PATH}), and only a
 * target shaped like one: an id has no `/` in it. "Outside" is the one idea the gates use
 * (`addressLiesOutside`).
 */
export function outsideTheProject(
  rel: string,
  target: string,
  root: string,
  scope: Scope = 'public',
): string | undefined {
  if (!RELATIONS_THAT_NAME_A_PATH.includes(rel)) return undefined;
  if (!addressLiesOutside(target, root)) return undefined;
  const why =
    scope === 'public'
      ? 'a link in the public tree reaches every clone, none of which can open that path'
      : `a link in the ${scope} tree would hold a path nothing in this project can follow`;
  const instead =
    scope === 'public'
      ? 'Link a path inside the project, or record the link with --scope private.'
      : 'Link a path inside the project.';
  return `"${oneLine(target)}" is outside this project, and ${why}. ${instead} Nothing was recorded.`;
}

/**
 * The target as the PUBLIC tree records it. An absolute path under the project root is written
 * relative to it, through the reduction the gates compare by (`addressRelativeToRoot`): an absolute
 * path is "inside" only on the machine whose root it names, and in a clone with another root it
 * would be an address outside the project, which is the one thing that tree must not carry. A
 * target already relative, a relation that carries no address, and a path outside (refused before
 * this is asked) are recorded as typed.
 */
export function targetAsRecorded(rel: string, target: string, root: string): string {
  if (!(ADDRESS_RELATIONS as readonly string[]).includes(rel)) return target;
  return reducedToRoot(target, root);
}

/** The one reduction: an absolute path goes relative to the root, anything else stays as it is. */
function reducedToRoot(target: string, root: string): string {
  if (!isAbsolute(target)) return target;
  return addressRelativeToRoot(target, root);
}

/**
 * The other spellings a READ may find a link's target under: what each project's public tree
 * records an absolute path under THAT project's root as, for the readings that take the text of a
 * target (`refs`, `timeline`, `audit_refs`, `audit_timeline`). It is the same reduction `link`
 * writes with, so a read and a write cannot disagree on what a path is recorded as. A workspace
 * holds several projects, and the path is reduced against each root that contains it: one
 * reduction per project, each answering for that project's public tree alone (`RecordedAs`).
 * Undefined when no project has another spelling (an id, a relative path, no project): the target
 * as typed is then the only one. What each may answer for is the reading's to decide by relation
 * and by tree: a relation that carries no address records the target as typed.
 */
export function targetRecordedAs(
  projects: readonly ResolvedTrees[],
  target: string,
): readonly RecordedAs[] | undefined {
  const spellings = new Map<string, RecordedAs>();
  for (const trees of projects) {
    if (trees.projectPublic === undefined) continue;
    const reduced = reducedToRoot(target, dirname(trees.projectPublic));
    if (reduced === target) continue;
    spellings.set(trees.projectPublic, { target: reduced, chainRoot: trees.projectPublic });
  }
  return spellings.size === 0 ? undefined : [...spellings.values()];
}

/**
 * Finds the tree a link is in by the target as TYPED, and failing that by the target as the public
 * tree would have recorded it (`targetAsRecorded`): a link written absolute by an earlier version is
 * still found by what it was written as, and one this version wrote relative is found by the
 * absolute path that named it. The typed form is asked first, so when both exist the one written
 * as typed is the one that is found. The reduced form is asked of the public tree alone, as it is
 * the only tree `link` reduces for. Returns where it is and the target as that tree holds it.
 */
export function locateLinkAsRecorded(
  trees: ResolvedTrees,
  edge: { readonly subject: string; readonly target: string; readonly rel: string },
  upcasters: UpcasterRegistry,
): { readonly scope: Scope; readonly target: string } | undefined {
  const typed = locateLinkScope(trees, edge, upcasters);
  if (typed !== undefined) return { scope: typed, target: edge.target };
  if (trees.projectPublic === undefined) return undefined;
  const target = targetAsRecorded(edge.rel, edge.target, dirname(trees.projectPublic));
  if (target === edge.target) return undefined;
  // The public tree is searched first, so a `public` answer is the public tree's own.
  const scope = locateLinkScope(trees, { ...edge, target }, upcasters);
  return scope === 'public' ? { scope, target } : undefined;
}
