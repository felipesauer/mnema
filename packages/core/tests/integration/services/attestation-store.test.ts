import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AttestationArtifact } from '@/services/audit/attestation-artifact.js';
import {
  attestPath,
  committedSignerResolver,
  listArtifacts,
  readArtifact,
  writeArtifact,
} from '@/services/audit/attestation-store.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';

/**
 * The attestation store: committed `.att` I/O under <auditDir>/attest/, and
 * the trust anchor — resolving committed `.pub` keys by FULL fingerprint, the
 * defence the head-signature path lacked (it resolved by a 12-char prefix).
 */
describe('attestation store', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attest-store-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  const artifact = (to: number, fingerprint = 'f'.repeat(64)): AttestationArtifact => ({
    version: 'mnema-attest/v1',
    signerActor: 'felipesauer',
    signerFingerprint: fingerprint,
    projectHmacId: 'ab'.repeat(32),
    from: to - 10,
    to,
    coveredHeadHash: 'deadbeef',
    contentRoot: 'cafe',
    signature: 'sig',
  });

  it('round-trips write → read', () => {
    writeArtifact(auditDir, artifact(10));
    expect(readArtifact(auditDir, 10)).toEqual(artifact(10));
  });

  it('read returns null for an absent artifact', () => {
    expect(readArtifact(auditDir, 99)).toBeNull();
  });

  it('lists artifacts ascending by to, skipping malformed files', () => {
    writeArtifact(auditDir, artifact(20));
    writeArtifact(auditDir, artifact(10));
    // A corrupt .att must not blind the loader to the valid ones.
    writeFileSync(attestPath(auditDir, 30), '{ not valid json', 'utf-8');
    const list = listArtifacts(auditDir);
    expect(list.map((a) => a.to)).toEqual([10, 20]);
  });

  it('lists nothing when the attest dir is absent', () => {
    expect(listArtifacts(auditDir)).toEqual([]);
  });

  describe('committedSignerResolver', () => {
    /** Mints a real committed .pub via MachineKeyService and returns its fp/pem. */
    function commitKey(actor: string) {
      const userDir = path.join(tempRoot, 'home', actor, '.config', 'mnema');
      mkdirSync(userDir, { recursive: true });
      const svc = new MachineKeyService(projectRoot, actor, userDir);
      const { fingerprint } = svc.getOrCreate();
      const pem = MachineKeyService.parsePublicKey(
        readFileSync(svc.publicKeyPath(), 'utf-8'),
      ).publicKey;
      return { fingerprint, pem, pubPath: svc.publicKeyPath() };
    }

    it('resolves a committed key by its FULL fingerprint', () => {
      const { fingerprint, pem } = commitKey('felipesauer');
      const resolve = committedSignerResolver(projectRoot);
      expect(resolve(fingerprint)).toBe(pem);
    });

    it('does not resolve a fingerprint that only shares the 12-char prefix', () => {
      // The gap the head-signature path had: resolving by prefix. Here the
      // resolver is keyed by the full 256-bit fingerprint, so a divergent
      // suffix (same 12-char prefix) must NOT resolve.
      const { fingerprint } = commitKey('felipesauer');
      const prefixCollision = `${fingerprint.slice(0, 12)}${'0'.repeat(52)}`;
      expect(prefixCollision).not.toBe(fingerprint);
      expect(committedSignerResolver(projectRoot)(prefixCollision)).toBeNull();
    });

    it('drops a .pub whose stored fingerprint was tampered to mismatch its key', () => {
      const { fingerprint, pubPath } = commitKey('felipesauer');
      // Swap the recorded fingerprint (keep the key): parsePublicKey rejects it,
      // so it is not a trusted signer under either fingerprint.
      const rec = JSON.parse(readFileSync(pubPath, 'utf-8'));
      const forged = { ...rec, fingerprint: '0'.repeat(64) };
      writeFileSync(pubPath, JSON.stringify(forged, null, 2), 'utf-8');
      const resolve = committedSignerResolver(projectRoot);
      expect(resolve(fingerprint)).toBeNull();
      expect(resolve('0'.repeat(64))).toBeNull();
    });

    it('resolves nothing when no keys are committed', () => {
      expect(committedSignerResolver(projectRoot)('f'.repeat(64))).toBeNull();
    });
  });
});
