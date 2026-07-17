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
import { MachineKeyService } from '@/services/integrity/machine-key.js';
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
        v: 1,
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

  it('buildArtifact refuses a negative from with a clean error, not a be64 RangeError', () => {
    // from < 0 satisfies `to > from` but would throw a cryptic RangeError from
    // writeBigUInt64BE; the range guard must reject it as a validation failure.
    const evs = events(6);
    const s = signer();
    expect(() =>
      buildArtifact({
        events: evs.slice(0, 6),
        from: -3,
        to: 3,
        signerActor: 'felipesauer',
        signerFingerprint: s.fingerprint,
        projectHmacId: hmacId,
        sign: s.sign,
      }),
    ).toThrow(/malformed attestation range/i);
  });

  it('parseArtifact rejects an inverted or negative range', () => {
    const base = {
      version: 'mnema-attest/v1',
      signerActor: 'a',
      signerFingerprint: 'f',
      projectHmacId: 'id',
      coveredHeadHash: 'h',
      contentRoot: 'r',
      signature: 's',
    };
    expect(() => parseArtifact(JSON.stringify({ ...base, from: 10, to: 5 }))).toThrow(
      /malformed attestation artifact/i,
    );
    expect(() => parseArtifact(JSON.stringify({ ...base, from: -1, to: 5 }))).toThrow(
      /malformed attestation artifact/i,
    );
  });

  it('verifyArtifact reports a negative from as malformed, never a crash', () => {
    const evs = events(10);
    const { artifact, resolve } = emit(evs, 0, 10);
    const bad = { ...artifact, from: -1 };
    expect(() => verifyArtifact(bad, evs.slice(0, 10), resolve)).not.toThrow();
    const verdict = verifyArtifact(bad, evs.slice(0, 10), resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/malformed range/i);
  });

  it('golden vector: leaf and root bytes are stable (guards canonicalise drift)', () => {
    // Pins the exact canonical bytes. canonicalise is JSON.stringify in
    // insertion order; if a refactor ever reorders AuditEvent fields, the leaf
    // an anonymous verifier recomputes would diverge from emit time and honest
    // batches would flip to "content root mismatch". This vector fails loudly
    // instead, before that ships.
    const fixed: AuditEvent = {
      v: 1,
      at: '2026-07-07T00:00:00.000Z',
      kind: 'task_created',
      actor: 'felipesauer',
      data: { id: 'T-0', title: 'task 0' },
      prev_hash: null,
      hash: 'ignored-by-canonicalise',
    };
    expect(computeLeaf(fixed).toString('hex')).toBe(
      '0524a923a492065cf9bc495f753d2826ea350a1ddd1f9dc80cecbf57522101ea',
    );
    // The `hash` field must NOT affect the leaf (canonicalise strips it), so a
    // different hash on the same content yields the same leaf.
    const sameContent: AuditEvent = { ...fixed, hash: 'a-different-hash' };
    expect(computeLeaf(sameContent).toString('hex')).toBe(computeLeaf(fixed).toString('hex'));
    expect(computeRoot(0, 1, [computeLeaf(fixed)]).length).toBe(32);
  });
});
