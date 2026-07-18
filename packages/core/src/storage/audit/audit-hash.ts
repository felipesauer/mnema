import { createHmac } from 'node:crypto';

import type { AuditEvent } from './audit-types.js';

/**
 * The audit event format tag written into every sealed line and checked by
 * the verifier. A future format change increments this and the verifier
 * gains a dispatch on the value; today it is the only accepted version.
 */
export const EVENT_FORMAT_VERSION = 1;

/**
 * Canonicalises an event for hashing: `JSON.stringify` over the event
 * with the `hash` field removed.
 *
 * Key order is the object's insertion order, which is stable because
 * both the writer (constructing the event) and the verifier (re-parsing
 * the serialised line) preserve it. Keeping one canonicaliser means the
 * writer and verifier can never disagree on the input — a divergence
 * that would falsely flag every line as tampered, or let a forged line
 * verify.
 *
 * @param event - Event in its pre-sealed form; any `hash` field is ignored
 * @returns The canonical JSON string
 */
export function canonicalise(event: AuditEvent): string {
  const { hash: _omit, ...rest } = event;
  return JSON.stringify(rest);
}

/**
 * The chain digest: HMAC-SHA256 of the canonical event keyed with the
 * per-project secret. Only a holder of the project secret can produce or
 * verify it, so it proves the event belongs to this project — a
 * clone-without-secret cannot forge an authentic line, and no one can
 * recompute a valid digest without the key.
 *
 * @param event - Event in its pre-sealed form; any `hash` field is ignored
 * @param secret - The per-project HMAC secret
 * @returns Hex-encoded HMAC-SHA256 digest of the canonical event
 */
export function hmacEvent(event: AuditEvent, secret: Buffer): string {
  return createHmac('sha256', secret).update(canonicalise(event)).digest('hex');
}
