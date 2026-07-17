import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AttestationSource,
  type HeadSignatureView,
  inspectAuditIntegrity,
} from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import {
  createAttestationSource,
  HeadCheckpointService,
} from '@/services/integrity/head-checkpoint.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * Layer 2 machine attestation, verified in inspectAuditIntegrity as a
 * SEPARATE verdict from chain consistency and HMAC authenticity: the latest
 * recorded head signature is checked against the committed public key of its
 * signer. A valid signature attests; a tampered head/signature is an error;
 * a signer whose .pub is missing is a warning (cannot attest), never a false
 * tamper.
 */
describe('audit machine attestation verdict', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attest-'));
    projectRoot = path.join(tempRoot, 'proj');
    userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    signatures = new AuditHeadSignatureRepository(adapter);
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Writes one event through a checkpoint-every-event signer. */
  function writeSignedEvent(): void {
    const checkpoint = new HeadCheckpointService(
      signatures,
      () => ({ machineKey, actor: 'felipesauer' }),
      {
        events: 1,
        seconds: 100_000,
      },
    );
    const audit = new AuditService(
      new AuditWriter(
        auditDir,
        new AuditStateRepository(adapter),
        () => Buffer.alloc(32, 7),
        undefined,
        checkpoint,
      ),
    );
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
  }

  const attestation = () => createAttestationSource(projectRoot, signatures);
  const attestationVerdict = (source: AttestationSource) =>
    inspectAuditIntegrity(adapter, auditDir, null, source).find(
      (c) => c.name === 'audit machine attestation',
    );

  it('attests a valid head signature against the committed public key', () => {
    writeSignedEvent();
    const verdict = attestationVerdict(attestation());
    expect(verdict?.ok).toBe(true);
    expect(verdict?.detail).toMatch(/head signed by felipesauer/i);
  });

  it('reports an error when the head signature does not verify (tampered)', () => {
    writeSignedEvent();
    // A source whose stored signature verifies against a DIFFERENT head.
    const real = signatures.read() as HeadSignatureView;
    const forged: AttestationSource = {
      readHeadSignature: () => ({ ...real, coveredHeadHash: 'f'.repeat(64) }),
      verifyHeadSignature: (sig) => attestation().verifyHeadSignature(sig),
    };
    const verdict = attestationVerdict(forged);
    expect(verdict?.ok).toBe(false);
    expect(verdict?.severity).toBe('error');
    expect(verdict?.detail).toMatch(/does not verify|tamper/i);
  });

  it('does not attest when the declared fingerprint diverges from the resolved key', () => {
    writeSignedEvent();
    // The `.pub` is named by the FULL fingerprint, so a signature row naming a
    // fingerprint the committed key does not own resolves to a filename that
    // simply does not exist — verification returns "cannot attest", never
    // silently verifying against some other key. (A hand-edited `.pub` renamed
    // to the declared fingerprint but carrying a different key is separately
    // caught by the fingerprint re-derivation in the bind.)
    const real = signatures.read() as HeadSignatureView;
    const divergent = `${'0'.repeat(63)}1`;
    expect(divergent).not.toBe(real.signerFingerprint);
    const forged: AttestationSource = {
      readHeadSignature: () => ({ ...real, signerFingerprint: divergent }),
      verifyHeadSignature: (sig) => attestation().verifyHeadSignature(sig),
    };
    const verdict = attestationVerdict(forged);
    // cannot attest (warning), never a green attestation on a mismatched key.
    expect(verdict?.ok).toBe(false);
    expect(verdict?.severity).toBe('warning');
    expect(verdict?.detail).toMatch(/not present|cannot attest/i);
  });

  it('warns (cannot attest), not tamper, when the signer public key is missing', () => {
    writeSignedEvent();
    // Remove the committed .pub so the signer's key cannot be resolved.
    rmSync(machineKey.publicKeyPath());
    const verdict = attestationVerdict(attestation());
    expect(verdict?.ok).toBe(false);
    expect(verdict?.severity).toBe('warning');
    expect(verdict?.detail).toMatch(/not present|cannot attest/i);
  });

  it('warns (cannot attest), not crash, when the committed .pub is corrupt', () => {
    writeSignedEvent();
    // Corrupt the committed public-key record (truncated JSON). parsePublicKey
    // would throw — the attestation source must swallow it into cannot-verify,
    // never crash the whole verify.
    writeFileSync(machineKey.publicKeyPath(), '{ "not": "valid pub', 'utf-8');
    let verdict: ReturnType<typeof attestationVerdict>;
    expect(() => {
      verdict = attestationVerdict(attestation());
    }).not.toThrow();
    expect(verdict?.ok).toBe(false);
    expect(verdict?.severity).toBe('warning');
    expect(verdict?.detail).toMatch(/not present|cannot attest/i);
  });

  it('warns (no signature yet) on a chain with no checkpoint signed', () => {
    // Write an event with NO checkpoint signer, so nothing is signed.
    const audit = new AuditService(
      new AuditWriter(
        auditDir,
        new AuditStateRepository(adapter),
        () => Buffer.alloc(32, 7),
        undefined,
        null,
      ),
    );
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    const verdict = attestationVerdict(attestation());
    expect(verdict?.ok).toBe(true);
    expect(verdict?.severity).toBe('warning');
    expect(verdict?.detail).toMatch(/no head signature yet/i);
  });

  it('is omitted entirely when no attestation source is wired', () => {
    writeSignedEvent();
    const verdict = inspectAuditIntegrity(adapter, auditDir, null, null).find(
      (c) => c.name === 'audit machine attestation',
    );
    expect(verdict).toBeUndefined();
  });
});
