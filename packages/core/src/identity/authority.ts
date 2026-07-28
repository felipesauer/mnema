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
 *
 * SCREENING IS BUNDLED HERE FOR THE SAME REASON, AND IT RUNS FIRST. `which` is
 * the envelope's only free-text field — `who` and `signerFp` are derived from a
 * key, `at` is an instant, `subject` and `run` are ids — so it is the one place a
 * credential can reach an event without passing through a payload. It is also the
 * worst place for one: `which` is stamped on EVERY event of a session, so a single
 * dirty value is as many disclosures as the session has facts, and over MCP it is
 * taken from the client's announced name, which nobody typed and nobody reads.
 * Screening it where it is already resolved makes "every free-text field is
 * screened" true of the envelope too, instead of true of the payload only.
 *
 * The order is screen, THEN canonicalize, and it is the same requirement stated
 * above: the value compared against `who` has to be the value the chain records.
 * Screening afterwards would compare one string and store another.
 */

import { type ContentTooLargeErr, screenContent } from '../content/screen.js';
import type { SecretClass } from '../content/secrets.js';
import { canonicalIdentity } from './who.js';

/** The refusal a self-authorized write earns: one code, one wording, everywhere. */
export interface SelfAuthorizedErr {
  readonly ok: false;
  readonly code: 'WHO_IS_WHICH';
  readonly message: string;
}

/** The executing agent resolved: the `which` to record, and what left it. */
export interface ExecutingAgentOk {
  readonly ok: true;
  /**
   * The canonical, SCREENED `which` an event should record — absent when the
   * caller named no agent (a human acting directly). This is the value to stamp
   * on the envelope; recording anything else would store a string the check never
   * saw.
   */
  readonly which?: string;
  /**
   * One entry per value replaced in the agent name. A caller merges it into its
   * own report, so a dirty `which` on an otherwise clean write still says what was
   * taken out — the whole point of not scrubbing in silence.
   */
  readonly replaced: readonly SecretClass[];
}

/**
 * The executing agent resolved, or the refusal it earned: it is the authorizing
 * identity, or the name was over the size limit.
 */
export type ExecutingAgent = ExecutingAgentOk | SelfAuthorizedErr | ContentTooLargeErr;

/**
 * Resolves the executing agent against the identity that authorizes the write:
 * screens the name, canonicalizes it, and checks it is not that identity. Returns
 * the `which` an event should record (absent when there is no agent) together with
 * what the screen replaced, or refuses `CONTENT_TOO_LARGE` / `WHO_IS_WHICH`.
 *
 * `who` is expected in canonical form already: a gate canonicalizes it to answer
 * "is there a human at all" (its own, distinct refusal), and a writer's anchor is
 * canonical by construction. Anything not a usable identity — a non-string from
 * an untrusted surface, blank, or uncanonicalizable — is treated as no agent at
 * all, the same reading {@link canonicalIdentity} gives it.
 *
 * The screen is idempotent, so a caller that already screened this string (the
 * session operation, whose payload `agent` IS the envelope's `which`) passes it
 * through here at no cost and reports the same classes once.
 *
 * A name that is ENTIRELY a credential comes back as the bare placeholder, and
 * that is the intended reading: the agent stays in the record as
 * `<SECRET:aws-access-key>`, which is odd to look at but honest, and strictly
 * better than stamping the credential itself on every event of the session. The
 * caller is told, so it can re-open the session with a name.
 */
export function resolveExecutingAgent(who: string, which: unknown): ExecutingAgent {
  // Screened BEFORE canonicalizing: what is compared against `who` below has to be
  // what the envelope records, and a screen that ran afterwards would break that.
  // A non-string is not text — there is nothing to weigh and nothing to clean — and
  // it is read as no agent at all, exactly as it was before.
  const screen = typeof which === 'string' ? screenContent({ which }) : undefined;
  if (screen !== undefined && !screen.ok) return screen;
  const replaced = screen?.replaced ?? [];

  const canonical = canonicalIdentity(screen === undefined ? which : screen.fields.which);
  if (canonical === undefined) return { ok: true, replaced };
  if (canonical === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }
  return { ok: true, which: canonical, replaced };
}
