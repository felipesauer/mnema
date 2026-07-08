import { sign as edSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildArtifact,
  computeLeaf,
  computeRoot,
  parseArtifact,
  serializeArtifact,
  verifyArtifact,
} from '@/services/audit/attestation-artifact.js';
import { MachineKeyService } from '@/services/machine-key.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * The mnema-attest/v1 crypto core (ADR-41): an anonymous verifier, with NO
 * project secret, recomputes the content root from the events on disk and
 * checks an Ed25519 signature against the committed public key. These are the
 * matured PoC's attacks turned into production tests: content edit, reorder,
 * a lied range, and a missing key all fail; the honest batch verifies.
 */
describe('attestation artifact (mnema-attest/v1)', () => {
  /** A deterministic per-machine keypair and its full fingerprint. */
  function signer() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const fingerprint = MachineKeyService.fingerprint(der);
    return {
      fingerprint,
      pem,
      sign: (message: Buffer) => edSign(null, message, privateKey),
    };
  }

  /** A chain of `n` events, each carrying a plausible SHA-256 `hash`. */
  function events(n: number, titlePrefix = 'task'): AuditEvent[] {
    const rows: AuditEvent[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const ev: AuditEvent = {
        v: 3,
        at: `2026-07-07T00:00:0${i}.000Z`,
        kind: 'task_created',
        actor: 'felipesauer',
        data: { id: `T-${i}`, title: `${titlePrefix} ${i}` },
        prev_hash: prev,
      };
      const hash = computeLeaf(ev).toString('hex'); // any stable per-event hash
      prev = hash;
      rows.push({ ...ev, hash });
    }
    return rows;
  }

  const hmacId = 'ab'.repeat(32); // sha256(secret) — committed, non-reversible

  function emit(evs: AuditEvent[], from: number, to: number, s = signer()) {
    const artifact = buildArtifact({
      events: evs.slice(from, to),
      from,
      to,
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      sign: s.sign,
    });
    const resolve = (fp: string) => (fp === s.fingerprint ? s.pem : null);
    return { artifact, resolve };
  }

  it('verifies an honest batch with no secret', () => {
    const evs = events(10);
    const { artifact, resolve } = emit(evs, 0, 10);
    expect(verifyArtifact(artifact, evs.slice(0, 10), resolve)).toEqual({ ok: true });
  });

  it('round-trips through serialise/parse unchanged', () => {
    const evs = events(6);
    const { artifact, resolve } = emit(evs, 0, 6);
    const reparsed = parseArtifact(serializeArtifact(artifact));
    expect(reparsed).toEqual(artifact);
    expect(verifyArtifact(reparsed, evs.slice(0, 6), resolve)).toEqual({ ok: true });
  });

  it('detects a content edit in a covered event', () => {
    const evs = events(10);
    const { artifact, resolve } = emit(evs, 0, 10);
    const tampered = evs.slice(0, 10);
    tampered[5] = { ...tampered[5], data: { ...tampered[5].data, title: 'HACKED' } };
    const verdict = verifyArtifact(artifact, tampered, resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/content root mismatch/i);
  });

  it('detects a reorder of covered events', () => {
    const evs = events(10);
    const { artifact, resolve } = emit(evs, 0, 10);
    const reordered = evs.slice(0, 10);
    [reordered[3], reordered[4]] = [reordered[4], reordered[3]];
    expect(verifyArtifact(artifact, reordered, resolve).ok).toBe(false);
  });

  it('detects a lied range: the same signature does not verify for a shorter to', () => {
    const evs = events(10);
    const s = signer();
    const { artifact } = emit(evs, 0, 10, s);
    const resolve = (fp: string) => (fp === s.fingerprint ? s.pem : null);
    // Attacker claims to=9 while keeping the original signature (made over to=10).
    // Recomputing over 9 events changes the root; the signature was over to=10.
    const lied = { ...artifact, to: 9, contentRoot: '', coveredHeadHash: evs[8].hash as string };
    const verdict = verifyArtifact(lied, evs.slice(0, 9), resolve);
    expect(verdict.ok).toBe(false);
  });

  it('reports cannot-attest (not tamper) when the signer key is absent', () => {
    const evs = events(10);
    const { artifact } = emit(evs, 0, 10);
    const verdict = verifyArtifact(artifact, evs.slice(0, 10), () => null);
    expect(verdict.ok).toBe(false);
    expect((verdict as { cannotAttest?: boolean }).cannotAttest).toBe(true);
  });

  it('rejects a corrupt signature without crashing', () => {
    const evs = events(10);
    const { artifact, resolve } = emit(evs, 0, 10);
    const corrupt = { ...artifact, signature: `${artifact.signature.slice(0, -4)}AAAA` };
    expect(() => verifyArtifact(corrupt, evs.slice(0, 10), resolve)).not.toThrow();
    expect(verifyArtifact(corrupt, evs.slice(0, 10), resolve).ok).toBe(false);
  });

  it('binds the boundaries into the root: moving an event between batches changes R', () => {
    const evs = events(20);
    const leaves = evs.map(computeLeaf);
    const r0to10 = computeRoot(0, 10, leaves.slice(0, 10));
    const r0to11 = computeRoot(0, 11, leaves.slice(0, 11));
    // Different ranges must never collide, even sharing a prefix of leaves.
    expect(r0to10.equals(r0to11)).toBe(false);
  });

  it('buildArtifact refuses an empty or malformed range', () => {
    expect(() => emit(events(5), 3, 3)).toThrow(/malformed attestation range/i);
  });
});
