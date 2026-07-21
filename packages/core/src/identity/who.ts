/**
 * The canonical form of an identity — the `who` (the human who authorized) and
 * the `which` (the agent that executed). One rule, in one place, used both to
 * VALIDATE an identity and to decide what gets WRITTEN, so the two never drift:
 * what the gate accepted is exactly what the event records.
 *
 * The rule is deliberately minimal — TRIM only. Trimming resolves the real,
 * common accident (a stray leading or trailing space spelling one person as
 * several) without ever fusing two people. Stronger normalization (case
 * folding, unicode, mapping a handle to a canonical identity) is NOT done here:
 * in an immutable proof log a false MERGE (two distinct people collapsed into
 * one) is permanent and severe, while a false SPLIT (one person seen as
 * several) is reversible once a real identity model exists — the chain never
 * loses the facts. So `Felipe` and `felipe` stay distinct on purpose,
 * reconcilable later; only whitespace is normalized now.
 */

/**
 * The canonical form of an identity, or undefined when the value is none — not
 * a string at all (junk forwarded from an untrusted surface), or empty once
 * trimmed (whitespace is no identity). The trimmed form is both what identity
 * comparison uses and what is written, so " alice" and "alice" are the same
 * person and cannot be played off against each other.
 */
export function canonicalIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
