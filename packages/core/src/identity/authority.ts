/**
 * The authority invariant: the agent that EXECUTED is never the identity that
 * AUTHORIZED.
 *
 * `who` is the anchor a fact is authorized by — derived from the writing key,
 * never typed in. `which` is the agent that executed it. When the two are the
 * same identity, nothing outside the agent stands behind the record: it
 * authorized its own work, and the accountability the chain exists to carry
 * collapses into a self-signed claim. So the check runs BEFORE any question of
 * legality, because it holds regardless of what is being recorded.
 *
 * One function, because every append needs it for the same reason and the shapes
 * that need it are not alike: a gated transition (a prior state to judge), a
 * birth (no prior state, but still an authorized fact), and a point-in-time fact
 * with no workflow at all. Spread across those shapes as a copied block, the
 * check was simply MISSING from the knowledge facts — a self-authorized capture
 * reached the chain and only the verifier caught it later, which in an
 * append-only log turns a refusable input into a permanent invalid entry. Failing
 * at the door is the whole point: one function makes "every append is checked" a
 * property of the code instead of a habit.
 *
 * Canonicalizing and comparing are bundled deliberately. The comparison must run
 * on the form the chain will STORE (see {@link canonicalIdentity}), so no caller
 * can compare one form and record another — which is exactly how a `which` that
 * "differs" from `who` at the check can end up byte-identical to it in the signed
 * event.
 */

import { canonicalIdentity } from './who.js';

/** The refusal a self-authorized write earns: one code, one wording, everywhere. */
export interface SelfAuthorizedErr {
  readonly ok: false;
  readonly code: 'WHO_IS_WHICH';
  readonly message: string;
}

/**
 * The executing agent resolved: the canonical `which` to record, absent when the
 * caller named no agent (a human acting directly) — or the refusal.
 */
export type ExecutingAgent = { readonly ok: true; readonly which?: string } | SelfAuthorizedErr;

/**
 * Resolves the executing agent against the identity that authorizes the write.
 * Returns the canonical `which` an event should record (absent when there is no
 * agent), or refuses `WHO_IS_WHICH` when the agent IS that identity.
 *
 * `who` is expected in canonical form already: a gate canonicalizes it to answer
 * "is there a human at all" (its own, distinct refusal), and a writer's anchor is
 * canonical by construction. Anything not a usable identity — a non-string from
 * an untrusted surface, blank, or uncanonicalizable — is treated as no agent at
 * all, the same reading {@link canonicalIdentity} gives it.
 */
export function resolveExecutingAgent(who: string, which: unknown): ExecutingAgent {
  const canonical = canonicalIdentity(which);
  if (canonical === undefined) return { ok: true };
  if (canonical === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }
  return { ok: true, which: canonical };
}
