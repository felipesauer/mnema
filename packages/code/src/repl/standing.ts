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
  /**
   * The identity this installation recorded for that tree, short.
   *
   * IT IS READ BY TWO THINGS AND THE SECOND IS THE POINT OF THE FIRST. It is on the
   * opening line, and it is who the session speaks as: a verb that requires the asker's
   * identity is handed this rather than demanding the caller type back what the box above
   * the prompt shows them (`asking.ts`). Both are the same value, which is what makes the
   * filled line the line the caller would have written by copying the screen.
   */
  readonly identity: string | undefined;
}

/**
 * Which trees can HOLD the answer to "who is this machine here", in the order they are
 * asked: the project's committed half, then its local one, and the machine's own tree for
 * a session that is in no project.
 *
 * The order is not a preference between two identities — a key records the same anchor
 * wherever it records one — it is about which tree HAS the file. `init` founds the identity
 * in the committed tree, so that is where it is in a project somebody started here; a clone
 * where the only local write was a memory has it in the private one, because that is the
 * tree such a write founds. Asking both is what keeps the bar from going blank in the
 * second case, and asking the committed one first is what makes the answer the one the
 * project's own record carries.
 *
 * THE OTHER SURFACE ASKS THIS DIFFERENTLY AND CAN AFFORD TO. `mcp/session.ts` names ONE
 * tree and gets an answer whatever the state, because reading the anchor there OPENS A
 * WRITER — which creates the tree and derives the anchor the key would found with. That is
 * a write door, measured as such (`--actor` is required on this CLI for exactly that
 * reason), and a session that only reads may not go through it. So this asks the trees that
 * may already hold one, and says nothing when none does.
 */
const ASKED: readonly Scope[] = ['public', 'private'];

/** Reads where a session opened, from local material only. */
export function standing(): Standing {
  const { cwd, env } = here();
  const trees = resolveTrees(cwd, env);
  const inProject = trees.projectPublic !== undefined;
  return {
    project: trees.projectPublic === undefined ? undefined : dirname(trees.projectPublic),
    identity: identityIn(trees, inProject ? ASKED : ['global']),
  };
}

/**
 * The identity this installation recorded in the first of `scopes` that holds one, in the
 * SHORT form.
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
function identityIn(trees: ResolvedTrees, scopes: readonly Scope[]): string | undefined {
  // Exactly one, or none named. Two private halves in a key root is the hazard the
  // keystore documents, and a bar that picked one of them would be a second place deciding
  // which key this machine is.
  const fingerprints = listPrivateKeyFingerprints({ root: trees.keyRoot });
  const only = fingerprints.length === 1 ? fingerprints[0] : undefined;
  if (only === undefined) return undefined;
  for (const scope of scopes) {
    const chainRoot = chainRootForScope(trees, scope);
    if (chainRoot === undefined) continue;
    const anchor = readAnchor({ root: chainRoot }, only);
    if (anchor !== null) return shortenAnchors([anchor]).get(anchor);
  }
  return undefined;
}
