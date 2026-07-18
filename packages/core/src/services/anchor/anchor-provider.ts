/**
 * Temporal anchoring. An {@link AnchorProvider} stamps the signed audit chain
 * head into an external, independently-verifiable timestamp (today a signed
 * git commit; a network-backed provider is one more file plus one registry
 * branch) and later verifies it. Anchoring is PLUGGABLE, OPT-IN (default
 * `none`), and runs OFF the write hot path, fail-open — a failed or slow
 * anchor never blocks or fails an audit write.
 *
 * Both methods are async so no provider can block synchronously on the hot
 * path even by accident; the scheduler still calls them off the write path and
 * fail-open regardless.
 */
export interface AnchorProvider {
  /** Stable name this provider is registered and configured under. */
  readonly name: string;

  /**
   * Anchors `head` (the signed chain-head hash, hex) into the provider's
   * external timestamp. Returns an opaque receipt to persist; the provider
   * is the only thing that understands its own receipt format. May return a
   * receipt whose proof is not yet confirmable (e.g. a push that has not
   * landed on the remote) — that is reported as `pending` at verify time,
   * not a failure.
   *
   * @param head - The chain-head hash to anchor (hex)
   * @returns The receipt to persist
   */
  stamp(head: string): Promise<AnchorReceipt>;

  /**
   * Verifies that `head` is anchored by `receipt`. Never throws for an
   * unproven-yet or offline case — those are `pending` / `cannot-verify`
   * states, distinct from `broken` (the receipt does not match the head).
   *
   * @param head - The chain-head hash the receipt should cover (hex)
   * @param receipt - A receipt previously returned by {@link stamp}
   * @returns The verification result
   */
  verify(head: string, receipt: AnchorReceipt): Promise<AnchorVerifyResult>;
}

/**
 * An opaque, provider-specific proof. `blob` is the serialized receipt
 * persisted verbatim (e.g. a commit sha); only the issuing provider
 * interprets it. `status` is the provider's own read of the proof at stamp
 * time.
 */
export interface AnchorReceipt {
  /** The provider that issued this receipt (must match on verify). */
  readonly provider: string;
  /** The head hash this receipt covers (hex). */
  readonly head: string;
  /** Serialized, provider-specific proof (persisted verbatim). */
  readonly blob: string;
  /** The provider's status at stamp time. */
  readonly status: AnchorStatus;
}

/**
 * The lifecycle status of an anchor.
 * - `pending`: submitted but not yet confirmable (e.g. a push that has not
 *   landed) — retry/upgrade later; NOT a failure.
 * - `anchored`: confirmed and independently verifiable.
 * - `failed`: the stamp attempt failed (fail-open — the write still stood).
 */
export type AnchorStatus = 'pending' | 'anchored' | 'failed';

/**
 * The result of {@link AnchorProvider.verify}.
 * - `not-anchored`: no anchor exists (the `none` provider, or nothing
 *   stamped yet) — a neutral state, never an error.
 * - `pending`: the proof exists but is not yet confirmable — never a false
 *   failure while maturing.
 * - `anchored`: the proof verifies and covers the head.
 * - `broken`: the proof does not match the head — tampering or a wrong
 *   receipt.
 * - `cannot-verify`: verification needs a resource not available here (e.g.
 *   offline, no access to the remote) — distinct from `broken`.
 */
export type AnchorVerifyState =
  | 'not-anchored'
  | 'pending'
  | 'anchored'
  | 'broken'
  | 'cannot-verify';

/** A verification verdict plus a human-readable detail. */
export interface AnchorVerifyResult {
  readonly state: AnchorVerifyState;
  readonly detail: string;
}
