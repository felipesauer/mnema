/**
 * `mnema key revoke <fingerprint> --reason <text>` — retire a key from this
 * identity, from this point forward.
 *
 * The third roster verb, and the one that answers a key going missing or leaking:
 * events the key signed while it was a member stay valid (a revocation is
 * prospective — past work does not become unattributable because a key was rotated
 * out), and anything it signs from here on fails verification.
 *
 * Scope is the project's PUBLIC tree, and only it, for the reason an enrollment is:
 * the retirement has to be where the other machines and an anonymous verifier read
 * it. A revocation recorded in a tree only this machine can see would retire
 * nothing anyone else can tell.
 *
 * A thin adapter. Which keys the identity has, whether this one is among them, and
 * whether it is the last — the core's judgement, worded by the core.
 */

import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { openTreeForWriting, revokeMember } from '@mnema/core/write';

/** What the revocation needs — injected so it is testable. */
export interface KeyRevokeContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home), for the key root and the tree paths. */
  readonly env: DiscoveryEnv;
}

/** The key was retired from this machine's identity. */
export interface KeyRevoked {
  readonly ok: true;
  readonly fingerprint: string;
  /** The identity it was retired from. */
  readonly anchor: string;
  /** True when the retired key is the one this machine signs with. */
  readonly self: boolean;
  /** How many keys the identity has left. */
  readonly remaining: number;
  /** The project tree that recorded it. */
  readonly root: string;
}

/** The revocation was refused; nothing was written. */
export type KeyRevokeRefused =
  /** There is no project here — a retirement is a fact in a committed record. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core refused: an unknown key, the last key, or no right to revoke. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Retires `fingerprint` from the identity this machine serves in the current
 * project. With no project found from the cwd it refuses `NO_PROJECT`.
 */
export function runKeyRevoke(
  ctx: KeyRevokeContext,
  input: { fingerprint: string; reason: string },
): KeyRevoked | KeyRevokeRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, 'public');
  const revoked = revokeMember(
    {
      writer,
      layout: { root: chainRootForScope(trees, 'public') as string },
      upcasters: catalogUpcasters(),
    },
    { fingerprint: input.fingerprint, reason: input.reason },
  );
  if (!revoked.ok) {
    return { ok: false, reason: 'REFUSED', code: revoked.code, message: revoked.message };
  }

  // The revocation signs its own checkpoint (the verifier only honors a covered
  // one), so this covers whatever else the run appended and is otherwise a no-op.
  writer.checkpoint();

  return {
    ok: true,
    fingerprint: revoked.fingerprint,
    anchor: revoked.anchor,
    self: revoked.self,
    remaining: revoked.remaining,
    root: trees.projectPublic,
  };
}
