import { sign as edSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { computeLeaf } from '@/services/audit/attestation-artifact.js';
import {
  buildPruneWaiver,
  buildTruncationWaiver,
  parseRebaselineWaiver,
  serializeRebaselineWaiver,
  verifyRebaselineWaiver,
} from '@/services/audit/rebaseline-waiver.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * The mnema-rebaseline/v1 crypto core: one SIGNED waiver format for every
 * genesis/head move. For a `prune` the committed anchor digest stands in for a
 * DELETED prefix; for a `truncation` there is no dropped prefix, only an
 * accepted lower head. An anonymous verifier (no project secret) trusts the
 * Ed25519 signature and re-checks that what survives on disk is what the waiver
 * was signed for — plus the project pin (foreign-project replay) and the tail
 * pin (sibling-tail replay).
 */
describe('rebaseline waiver (mnema-rebaseline/v1)', () => {
  function signer() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const fingerprint = MachineKeyService.fingerprint(der);
    return { fingerprint, pem, sign: (message: Buffer) => edSign(null, message, privateKey) };
  }

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
  const tailId = 'm-0000000000aa';
  const at = '2026-07-16T00:00:00.000Z';

  /** Emit a PRUNE waiver dropping `[0, cut)` from a chain of `total` events. */
  function emitPrune(total: number, cut: number, s = signer()) {
    const evs = events(total);
    const dropped = evs.slice(0, cut);
    const genesisHash = evs[cut]?.hash as string;
    const waiver = buildPruneWaiver({
      droppedEvents: dropped,
      genesisHash,
      survivingEventCount: total - cut,
      tailId,
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      acceptedAt: at,
      sign: s.sign,
    });
    const resolve = (fp: string) => (fp === s.fingerprint ? s.pem : null);
    return { evs, waiver, resolve, genesisHash, signer: s };
  }

  /** Emit a TRUNCATION waiver accepting a new head/count. */
  function emitTruncation(headHash: string, count: number, s = signer()) {
    const waiver = buildTruncationWaiver({
      newHeadHash: headHash,
      newEventCount: count,
      tailId,
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      acceptedAt: at,
      sign: s.sign,
    });
    const resolve = (fp: string) => (fp === s.fingerprint ? s.pem : null);
    return { waiver, resolve };
  }

  // --- prune ---

  it('verifies an honest prune waiver against the surviving genesis, no secret', () => {
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    expect(verifyRebaselineWaiver(waiver, genesisHash, tailId, hmacId, resolve)).toEqual({
      ok: true,
    });
  });

  it('round-trips through serialise/parse unchanged', () => {
    const { waiver, resolve, genesisHash } = emitPrune(8, 3);
    const reparsed = parseRebaselineWaiver(serializeRebaselineWaiver(waiver));
    expect(reparsed).toEqual(waiver);
    expect(verifyRebaselineWaiver(reparsed, genesisHash, tailId, hmacId, resolve)).toEqual({
      ok: true,
    });
  });

  it('refuses a waiver replayed against a DIFFERENT surviving genesis (deeper move)', () => {
    const { evs, waiver, resolve } = emitPrune(10, 4);
    const deeperGenesis = evs[6]?.hash as string;
    const verdict = verifyRebaselineWaiver(waiver, deeperGenesis, tailId, hmacId, resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/deeper than the one accepted/i);
  });

  it('refuses a waiver minted for a DIFFERENT project (project-id pin)', () => {
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    const verdict = verifyRebaselineWaiver(waiver, genesisHash, tailId, 'ff'.repeat(32), resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/different project/i);
  });

  it('refuses a waiver replayed against a DIFFERENT tail (tail pin)', () => {
    // The tail id is folded into the signed bytes; a waiver for m-...aa cannot
    // re-baseline a sibling tail even if the genesis hash happens to collide.
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    const verdict = verifyRebaselineWaiver(waiver, genesisHash, 'm-0000000000bb', hmacId, resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/for tail .* not/i);
  });

  it('skips the project pin when the project committed no fingerprint (null)', () => {
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    expect(verifyRebaselineWaiver(waiver, genesisHash, tailId, null, resolve)).toEqual({
      ok: true,
    });
  });

  it('refuses a signer takeover: a rogue committed key cannot re-sign the digest', () => {
    const { waiver, genesisHash } = emitPrune(10, 4);
    const rogue = signer();
    const takenOver = { ...waiver, signerFingerprint: rogue.fingerprint };
    const resolveRogue = (fp: string) => (fp === rogue.fingerprint ? rogue.pem : null);
    expect(verifyRebaselineWaiver(takenOver, genesisHash, tailId, hmacId, resolveRogue).ok).toBe(
      false,
    );
  });

  it('detects a tampered cut, anchor digest, and pruned-head hash', () => {
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    for (const tampered of [
      { ...waiver, cut: 3 },
      { ...waiver, anchorDigest: 'cd'.repeat(32) },
      { ...waiver, prunedHeadHash: 'deadbeef' },
    ]) {
      expect(verifyRebaselineWaiver(tampered, genesisHash, tailId, hmacId, resolve).ok).toBe(false);
    }
  });

  it('reports cannot-verify (not tamper) when the signer key is absent', () => {
    const { waiver, genesisHash } = emitPrune(10, 4);
    const verdict = verifyRebaselineWaiver(waiver, genesisHash, tailId, hmacId, () => null);
    expect(verdict.ok).toBe(false);
    expect((verdict as { cannotVerify?: boolean }).cannotVerify).toBe(true);
  });

  it('rejects a corrupt signature without crashing', () => {
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    const corrupt = { ...waiver, signature: `${waiver.signature.slice(0, -4)}AAAA` };
    expect(() =>
      verifyRebaselineWaiver(corrupt, genesisHash, tailId, hmacId, resolve),
    ).not.toThrow();
    expect(verifyRebaselineWaiver(corrupt, genesisHash, tailId, hmacId, resolve).ok).toBe(false);
  });

  it('buildPruneWaiver refuses a zero cut (nothing to prune)', () => {
    const s = signer();
    expect(() =>
      buildPruneWaiver({
        droppedEvents: [],
        genesisHash: 'g',
        survivingEventCount: 0,
        tailId,
        signerActor: 'a',
        signerFingerprint: s.fingerprint,
        projectHmacId: hmacId,
        acceptedAt: at,
        sign: s.sign,
      }),
    ).toThrow(/nothing to prune/i);
  });

  // --- truncation ---

  it('verifies an honest truncation waiver against the accepted head', () => {
    const head = 'ab'.repeat(32);
    const { waiver, resolve } = emitTruncation(head, 5);
    expect(waiver.kind).toBe('truncation');
    expect(waiver.cut).toBe(0);
    expect(verifyRebaselineWaiver(waiver, head, tailId, hmacId, resolve)).toEqual({ ok: true });
  });

  it('refuses a truncation waiver replayed against a DIFFERENT head (deeper retreat)', () => {
    const { waiver, resolve } = emitTruncation('ab'.repeat(32), 5);
    const verdict = verifyRebaselineWaiver(waiver, 'cd'.repeat(32), tailId, hmacId, resolve);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/does not match the waiver/i);
  });

  it('a prune waiver cannot be reinterpreted as a truncation (kind is signed)', () => {
    // Flipping the kind changes the signed bytes, so the signature no longer
    // verifies — a prune record cannot masquerade as an accepted truncation.
    const { waiver, resolve, genesisHash } = emitPrune(10, 4);
    const flipped = { ...waiver, kind: 'truncation' as const };
    expect(verifyRebaselineWaiver(flipped, genesisHash, tailId, hmacId, resolve).ok).toBe(false);
  });

  it('buildTruncationWaiver refuses an empty head or a bad count', () => {
    const s = signer();
    const base = {
      tailId,
      signerActor: 'a',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      acceptedAt: at,
      sign: s.sign,
    };
    expect(() => buildTruncationWaiver({ ...base, newHeadHash: '', newEventCount: 3 })).toThrow(
      /no hash/i,
    );
    expect(() => buildTruncationWaiver({ ...base, newHeadHash: 'h', newEventCount: -1 })).toThrow(
      /malformed/i,
    );
  });
});
