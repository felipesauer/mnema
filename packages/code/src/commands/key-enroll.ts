/**
 * `mnema key enroll <request>` — vouch for a key so it joins this identity.
 *
 * The second step of putting two machines on one identity, and the one that has to
 * run on a machine that is ALREADY a member: membership is granted by a member's
 * signature, so there is no way for a joining machine to admit itself.
 *
 * Scope is the project's PUBLIC tree, and only it. An enrollment is a per-tree
 * fact, and the tree that matters is the committed one — it is what the other
 * machine will read to learn it was accepted, and what an anonymous verifier
 * checks the vouch against. The private and global trees are local to one machine,
 * so a second machine could never see an enrollment recorded there.
 *
 * A thin adapter: resolve the project, hand ONE core operation a deferred write of the
 * tree, report what came back. Whether the request proves consent, whether this machine
 * may vouch, whether the key is already a member — all of it is the core's judgement and
 * reaches the person as the core worded it.
 *
 * DEFERRED, and not an open writer, because opening one touches the tree before anything
 * is appended — an installation id, today. Measured on the binary, a refused enrollment
 * used to leave the project with an untracked `keys/<fp>.pub` and an empty tail of the key
 * that asked — which is the key a person following the words of a split has at hand; those
 * two are born at a writer's first append now, and the id is still a file. The core decides
 * first and opens the writer only to write, so a refusal leaves the tree as it found it.
 */

import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { deferredWrite, enrollFromRequest } from '@mnema/core/write';

/** What the enrollment needs — injected so it is testable. */
export interface KeyEnrollContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`), for the key root and the tree paths. */
  readonly env: DiscoveryEnv;
}

/** The key belongs to this machine's identity. */
export interface KeyEnrolled {
  readonly ok: true;
  /** The joining key's fingerprint, derived from the key the request carried. */
  readonly fingerprint: string;
  /** The identity it now belongs to — this machine's own. */
  readonly anchor: string;
  /** True when the record already proved it a member, so nothing was appended. */
  readonly alreadyMember: boolean;
  /** The project tree that recorded it. */
  readonly root: string;
}

/** The enrollment was refused; nothing was written. */
export type KeyEnrollRefused =
  /** There is no project here — an enrollment is a fact in a committed record. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core refused: a malformed request, one made for another identity, no right to vouch. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Enrolls the key a request carries into the identity this machine serves in the
 * current project. With no project found from the cwd it refuses `NO_PROJECT`: a
 * vouch is a fact, and a fact needs the record the other machine will read.
 */
export function runKeyEnroll(
  ctx: KeyEnrollContext,
  input: { request: string },
): KeyEnrolled | KeyEnrollRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const write = deferredWrite(trees, 'public');
  const enrolled = enrollFromRequest(write, { request: input.request });
  if (!enrolled.ok) {
    return { ok: false, reason: 'REFUSED', code: enrolled.code, message: enrolled.message };
  }

  // The enrollment signs its own checkpoint, so this only covers the founding a first-ever
  // write may have appended alongside it — and is a no-op otherwise, including when the
  // writer was never opened (a key the record already proved a member).
  write.checkpoint();

  return {
    ok: true,
    fingerprint: enrolled.fingerprint,
    anchor: enrolled.anchor,
    alreadyMember: enrolled.alreadyMember,
    root: trees.projectPublic,
  };
}
