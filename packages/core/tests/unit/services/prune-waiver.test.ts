import { sign as edSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { computeLeaf } from '@/services/audit/attestation-artifact.js';
import {
  buildPruneWaiver,
  computeAnchorDigest,
  parsePruneWaiver,
  serializePruneWaiver,
  verifyPruneWaiver,
} from '@/services/audit/prune-waiver.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * The mnema-prune/v1 crypto core (ADR-68): a SIGNED waiver whose committed
 * anchor digest stands in for a pruned prefix that has been DELETED. An
 * anonymous verifier (no project secret) cannot recompute the digest — the
 * content is gone — so it trusts the Ed25519 signature over it and re-checks
 * that the surviving genesis on disk is the one the waiver was signed for. The
 * genesis binding is what stops a waiver from laundering a DEEPER truncation.
 */
describe('prune waiver (mnema-prune/v1)', () => {
  function signer() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const fingerprint = MachineKeyService.fingerprint(der);
    return { fingerprint, pem, sign: (message: Buffer) => edSign(null, message, privateKey) };
  }

  /** A chain of `n` events, each carrying a plausible per-event hash. */
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
      const hash = computeLeaf(ev).toString('hex');
      prev = hash;
      rows.push({ ...ev, hash });
    }
    return rows;
  }

  const hmacId = 'ab'.repeat(32);
  const at = '2026-07-16T00:00:00.000Z';

  /** Emit a waiver dropping `[0, cut)` from a chain of `total` events. */
  function emit(total: number, cut: number, s = signer()) {
    const evs = events(total);
    const dropped = evs.slice(0, cut);
    const genesisHash = evs[cut]?.hash as string;
    const waiver = buildPruneWaiver({
      droppedEvents: dropped,
      genesisHash,
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      acceptedAt: at,
      sign: s.sign,
    });
    const resolve = (fp: string) => (fp === s.fingerprint ? s.pem : null);
    return { evs, waiver, resolve, genesisHash, signer: s };
  }

  it('verifies an honest prune waiver against the surviving genesis, with no secret', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    expect(verifyPruneWaiver(waiver, genesisHash, hmacId, resolve)).toEqual({ ok: true });
  });

  it('round-trips through serialise/parse unchanged', () => {
    const { waiver, resolve, genesisHash } = emit(8, 3);
    const reparsed = parsePruneWaiver(serializePruneWaiver(waiver));
    expect(reparsed).toEqual(waiver);
    expect(verifyPruneWaiver(reparsed, genesisHash, hmacId, resolve)).toEqual({ ok: true });
  });

  it('refuses a waiver replayed against a DIFFERENT surviving genesis (deeper truncation)', () => {
    // The waiver was signed for a specific genesis; a deeper truncation moves
    // the genesis, and the old waiver must not cover it.
    const { evs, waiver, resolve } = emit(10, 4);
    const deeperGenesis = evs[6]?.hash as string; // as if pruned to cut=6, not 4
    const verdict = verifyPruneWaiver(waiver, deeperGenesis, hmacId, resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/deeper than the accepted prune/i);
  });

  it('refuses a waiver minted for a DIFFERENT project (project-id pin)', () => {
    // A foreign waiver's signature verifies against its own committed key, so
    // the project pin is the only thing tying it to this project.
    const { waiver, resolve, genesisHash } = emit(10, 4);
    const verdict = verifyPruneWaiver(waiver, genesisHash, 'ff'.repeat(32), resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/different project/i);
  });

  it('skips the project pin when the project committed no fingerprint (null)', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    expect(verifyPruneWaiver(waiver, genesisHash, null, resolve)).toEqual({ ok: true });
  });

  it('refuses a signer takeover: a rogue committed key cannot re-sign the same digest', () => {
    // signerFingerprint is folded into the signed bytes, so a holder of ANY
    // committed .pub cannot re-sign the identical digest and re-point the
    // signer to their own key.
    const { waiver } = emit(10, 4);
    const rogue = signer();
    // Rogue re-signs the SAME logical content but bound to the honest signer's
    // fingerprint (as they would need to, to impersonate) — signature fails.
    // And if they re-point to their own fingerprint, the signed bytes differ
    // from the honest waiver's, so the original signature no longer matches.
    const takenOver = { ...waiver, signerFingerprint: rogue.fingerprint };
    const resolveRogue = (fp: string) => (fp === rogue.fingerprint ? rogue.pem : null);
    // The honest signature was over the honest fingerprint's bytes; verifying
    // it under the rogue fingerprint's sign input fails.
    expect(verifyPruneWaiver(takenOver, waiver.genesisHash, hmacId, resolveRogue).ok).toBe(false);
  });

  it('detects a tampered cut: the same signature does not verify for a lied cut', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    const lied = { ...waiver, cut: 3 };
    expect(verifyPruneWaiver(lied, genesisHash, hmacId, resolve).ok).toBe(false);
  });

  it('detects a tampered anchor digest', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    const tampered = { ...waiver, anchorDigest: 'cd'.repeat(32) };
    expect(verifyPruneWaiver(tampered, genesisHash, hmacId, resolve).ok).toBe(false);
  });

  it('detects a tampered pruned-head hash', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    const tampered = { ...waiver, prunedHeadHash: 'deadbeef' };
    expect(verifyPruneWaiver(tampered, genesisHash, hmacId, resolve).ok).toBe(false);
  });

  it('reports cannot-verify (not tamper) when the signer key is absent', () => {
    const { waiver, genesisHash } = emit(10, 4);
    const verdict = verifyPruneWaiver(waiver, genesisHash, hmacId, () => null);
    expect(verdict.ok).toBe(false);
    expect((verdict as { cannotVerify?: boolean }).cannotVerify).toBe(true);
  });

  it('rejects a corrupt signature without crashing', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    const corrupt = { ...waiver, signature: `${waiver.signature.slice(0, -4)}AAAA` };
    expect(() => verifyPruneWaiver(corrupt, genesisHash, hmacId, resolve)).not.toThrow();
    expect(verifyPruneWaiver(corrupt, genesisHash, hmacId, resolve).ok).toBe(false);
  });

  it('rejects an anchor digest that is not a 32-byte hash', () => {
    const { waiver, resolve, genesisHash } = emit(10, 4);
    const bad = { ...waiver, anchorDigest: 'ab' };
    const verdict = verifyPruneWaiver(bad, genesisHash, hmacId, resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/not a 32-byte hash/i);
  });

  it('buildPruneWaiver refuses a zero cut (nothing to prune)', () => {
    const s = signer();
    expect(() =>
      buildPruneWaiver({
        droppedEvents: [],
        genesisHash: 'g',
        signerActor: 'a',
        signerFingerprint: s.fingerprint,
        projectHmacId: hmacId,
        acceptedAt: at,
        sign: s.sign,
      }),
    ).toThrow(/nothing to prune/i);
  });

  it('buildPruneWaiver refuses when the pruned head event has no hash', () => {
    const s = signer();
    const dropped = events(3).map((e) => ({ ...e, hash: undefined as unknown as string }));
    expect(() =>
      buildPruneWaiver({
        droppedEvents: dropped,
        genesisHash: 'g',
        signerActor: 'a',
        signerFingerprint: s.fingerprint,
        projectHmacId: hmacId,
        acceptedAt: at,
        sign: s.sign,
      }),
    ).toThrow(/no hash/i);
  });

  it('parsePruneWaiver rejects a malformed record', () => {
    const base = {
      version: 'mnema-prune/v1',
      signerActor: 'a',
      signerFingerprint: 'f',
      projectHmacId: 'id',
      anchorDigest: 'd',
      prunedHeadHash: 'p',
      genesisHash: 'g',
      signature: 's',
    };
    expect(() => parsePruneWaiver(JSON.stringify({ ...base, cut: 0 }))).toThrow(
      /malformed prune waiver/i,
    );
    expect(() => parsePruneWaiver(JSON.stringify({ ...base, cut: -1 }))).toThrow(
      /malformed prune waiver/i,
    );
    expect(() => parsePruneWaiver(JSON.stringify({ version: 'other', cut: 3 }))).toThrow(
      /not a mnema-prune/i,
    );
  });

  it('parsePruneWaiver rejects empty-string genesis/head/digest (no degeneracies)', () => {
    const base = {
      version: 'mnema-prune/v1',
      signerActor: 'a',
      signerFingerprint: 'f',
      projectHmacId: 'id',
      anchorDigest: 'd',
      prunedHeadHash: 'p',
      genesisHash: 'g',
      signature: 's',
      cut: 3,
    };
    expect(() => parsePruneWaiver(JSON.stringify({ ...base, genesisHash: '' }))).toThrow(
      /malformed prune waiver/i,
    );
    expect(() => parsePruneWaiver(JSON.stringify({ ...base, prunedHeadHash: '' }))).toThrow(
      /malformed prune waiver/i,
    );
    expect(() => parsePruneWaiver(JSON.stringify({ ...base, anchorDigest: '' }))).toThrow(
      /malformed prune waiver/i,
    );
  });

  it('the anchor digest binds the dropped content: editing a dropped event changes it', () => {
    const evs = events(10);
    const digestA = computeAnchorDigest(evs.slice(0, 4));
    const edited = evs.slice(0, 4);
    edited[2] = { ...edited[2], data: { ...edited[2].data, title: 'HACKED' } };
    const digestB = computeAnchorDigest(edited);
    expect(digestA.equals(digestB)).toBe(false);
  });
});
