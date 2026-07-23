/**
 * `mnema verify` — verify the current project's chain.
 *
 * The proof, surfaced. It resolves the project from the cwd and runs the chain's
 * own `verify` over it, returning the verdict as the chain computed it. The
 * command adds NO judgement of its own: `verify`'s result — and its one-line
 * `summary` — is honest by construction (it distinguishes "nothing verifiable is
 * broken" from "everything is authenticated", and reports the external witness
 * T3 as not-covered). The surface must preserve that honesty, never dress it up
 * into a "tamper-proof" claim the proof does not make; so it passes the verdict
 * through unchanged and the CLI prints its summary verbatim.
 *
 * Scope is the project of the cwd — the minimum a person asks for at a project
 * root. Verifying across projects (via the index) is a later, separate concern.
 */

import { catalogUpcasters, type VerifyResult, verify } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';

/** What verify needs — injected so it is testable. */
export interface VerifyContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The verdict, with the tree it covered. */
export interface VerifyDone {
  readonly ok: true;
  /** The project tree that was verified. */
  readonly root: string;
  /** The chain's verdict, unmodified. */
  readonly result: VerifyResult;
}

/** There was nothing to verify — no project here. */
export type VerifyRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/**
 * Verifies the current project's public tree. With no project found from the
 * cwd, there is nothing to verify here, so it refuses with `NO_PROJECT` rather
 * than reporting a hollow "ok" over a tree that does not exist.
 */
export function runVerify(ctx: VerifyContext): VerifyDone | VerifyRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const result = verify(trees.projectPublic, catalogUpcasters());
  return { ok: true, root: trees.projectPublic, result };
}
