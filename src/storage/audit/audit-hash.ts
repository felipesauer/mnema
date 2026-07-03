import { createHash } from 'node:crypto';

import type { AuditEvent } from './audit-writer.js';

/**
 * Canonicalises an event and returns its digest, with the `hash` field
 * omitted from the input. This is the single source of truth for the
 * chain's per-line hash: the writer calls it to fill in `hash`, and the
 * verifier (`inspectAuditIntegrity`) calls the same function to
 * recompute and compare. Keeping one implementation means a change to
 * the canonicalisation (key order, field omission, serialisation) can
 * never make the writer and the verifier disagree — a divergence that
 * would falsely flag every existing line as tampered, or worse, let a
 * forged line verify.
 *
 * Canonicalisation is `JSON.stringify` over the event with `hash`
 * removed. Key order is therefore the object's insertion order, which
 * is stable because both the writer (constructing the event) and the
 * verifier (re-parsing the serialised line) preserve it.
 *
 * @param event - Event in its pre-sealed form; any `hash` field is ignored
 * @returns Hex-encoded SHA-256 digest of the canonical event
 */
export function hashEvent(event: AuditEvent): string {
  const { hash: _omit, ...rest } = event;
  const payload = JSON.stringify(rest);
  return createHash('sha256').update(payload).digest('hex');
}
