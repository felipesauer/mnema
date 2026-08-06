/**
 * WHERE THE SESSION STANDS — the two facts a status line carries, and the record is not
 * consulted for either of them.
 *
 * THAT IS THE WHOLE DESIGN, AND IT IS MEASURED. `verify` over this product's own record
 * costs about 110 ms; every read this surface has opens the projections. A status line
 * that asked the record anything would pay that on the way in, and a status line that
 * asked it again would turn a console into a replay loop. So what is here is what the
 * FILESYSTEM answers without opening a chain: which directory the project's tree sits in,
 * and which identity this installation recorded for that tree. Both are one `readdir` and
 * one small file, both are resolved ONCE when the session opens, and there is a guard that
 * counts the reads to say so (`tests/the-name-and-the-hints.test.ts`).
 *
 * WHAT IT DELIBERATELY DOES NOT ANSWER, and why the absence is the honest shape:
 *
 *   - NOT THE COUNT OF ANYTHING. How many tasks are open, how many events there are, what
 *     the verdict is — every one of those is a read of the record, and the session has
 *     verbs for all of them. A bar that answered them would be answering them again on
 *     every keystroke.
 *   - NOT WHICH IDENTITY A MACHINE WITH TWO KEYS SPEAKS AS. A key root holding two private
 *     halves makes the answer depend on the order the filesystem lists them
 *     (`listPrivateKeyFingerprints` says so where it is defined), and this does not
 *     re-decide it in a second place — it declines to name one. The hazard is the
 *     writer's to settle, not a status line's to guess at.
 *   - NOT WHAT THE RECORD SAYS ABOUT THAT IDENTITY. The value here is what this
 *     INSTALLATION recorded for this tree — the anchor it founded, or the one it enrolled
 *     into — read from the same file the writer reads it from. A key the record has since
 *     retired would still be named here; the record is what settles that, `verify` and the
 *     audit reads are where it speaks, and both are one word away at the prompt.
 */

import { dirname } from 'node:path';
import { listPrivateKeyFingerprints, readAnchor } from '@mnema/chain';
import {
  chainRootForScope,
  type ResolvedTrees,
  resolveTrees,
  type Scope,
  shortenAnchors,
} from '@mnema/core';
import { here } from '../wiring/context.js';

/** The cheap facts about where a session is. Each is absent when it is not known. */
export interface Standing {
  /** The directory the project's tree sits in, or none when there is no project. */
  readonly project: string | undefined;
  /** The identity this installation recorded for that tree, short. */
  readonly identity: string | undefined;
}

/**
 * Reads where a session opened, from local material only.
 *
 * The tree the identity is asked of is the PRIVATE one inside a project and the GLOBAL one
 * outside it — an installation records the anchor it serves per tree, so "who is this
 * machine here" has one answer per tree and the question needs one named. It is the same
 * tree the other surface asks it of (`mcp/session.ts`), for the same reason and by the
 * same rule.
 */
export function standing(): Standing {
  const { cwd, env } = here();
  const trees = resolveTrees(cwd, env);
  const scope: Scope = trees.projectPublic === undefined ? 'global' : 'private';
  return {
    project: trees.projectPublic === undefined ? undefined : dirname(trees.projectPublic),
    identity: identityOf(trees, scope),
  };
}

/**
 * The identity this installation recorded for one tree, in the SHORT form.
 *
 * The short form is a PREFIX of the value, produced by the same function every read of
 * this product shortens with — so anyone holding the whole anchor can see this one at the
 * front of it, with no lookup and nothing to trust. What it is shortened against is the
 * one identity this machine can name without opening the record, which is narrower than
 * what a READ shortens against (the identities the record knows, see `anchors.ts`), and
 * the difference has one consequence, named rather than hidden: a prefix that two
 * identities of the record share is refused when it is typed back, by name, with both
 * candidates in the sentence — the product's existing answer for an ambiguous prefix. It
 * is never resolved to the wrong one.
 */
function identityOf(trees: ResolvedTrees, scope: Scope): string | undefined {
  const chainRoot = chainRootForScope(trees, scope);
  if (chainRoot === undefined) return undefined;
  // Exactly one, or none named. Two private halves in a key root is the hazard the
  // keystore documents, and a bar that picked one of them would be a second place deciding
  // which key this machine is.
  const fingerprints = listPrivateKeyFingerprints({ root: trees.keyRoot });
  const only = fingerprints.length === 1 ? fingerprints[0] : undefined;
  if (only === undefined) return undefined;
  const anchor = readAnchor({ root: chainRoot }, only);
  if (anchor === null) return undefined;
  return shortenAnchors([anchor]).get(anchor);
}
