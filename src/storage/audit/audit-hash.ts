import { createHash, createHmac } from 'node:crypto';

import type { AuditEvent } from './audit-writer.js';

/**
 * Canonicalises an event for hashing: `JSON.stringify` over the event
 * with the `hash` field removed. Shared by {@link hashEvent} (v2
 * SHA-256) and {@link hmacEvent} (v3 HMAC) so the two versions differ
 * ONLY in the keying, never in the bytes fed to the digest.
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
 * v2 chain digest: plain SHA-256 of the canonical event. This is the
 * legacy, keyless hash — anyone can recompute it, so it detects
 * accidental corruption and continuity breaks but NOT a motivated
 * editor. Kept byte-for-byte identical so historical v2 lines always
 * re-verify. New events use {@link hmacEvent} (v3) when a project secret
 * is available.
 *
 * @param event - Event in its pre-sealed form; any `hash` field is ignored
 * @returns Hex-encoded SHA-256 digest of the canonical event
 */
export function hashEvent(event: AuditEvent): string {
  return createHash('sha256').update(canonicalise(event)).digest('hex');
}

/**
 * v3 chain digest: HMAC-SHA256 of the canonical event keyed with the
 * per-project secret (ADR-37 layer 2). Only a holder of the project
 * secret can produce or verify it, so it proves the event belongs to
 * this project (a clone-without-secret cannot forge an authentic line).
 * The canonical input is identical to {@link hashEvent}; only the keying
 * differs, so the two are directly comparable modulo the key.
 *
 * @param event - Event in its pre-sealed form; any `hash` field is ignored
 * @param secret - The per-project HMAC secret
 * @returns Hex-encoded HMAC-SHA256 digest of the canonical event
 */
export function hmacEvent(event: AuditEvent, secret: Buffer): string {
  return createHmac('sha256', secret).update(canonicalise(event)).digest('hex');
}
