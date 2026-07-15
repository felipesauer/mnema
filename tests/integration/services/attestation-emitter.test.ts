import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyArtifact } from '@/services/audit/attestation-artifact.js';
import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { committedSignerResolver } from '@/services/audit/attestation-store.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';

/**
 * The emitter turns a walked range [from, to) into a signed .att, and what it
 * emits must verify against the committed .pub with NO secret — the end-to-end
 * proof that walk + crypto + store + machine-key compose.
 */
describe('attestation emitter', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let userDir: string;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attest-emit-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    machineKey.getOrCreate(); // mint the keypair + commit the .pub
  });
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  const hmacId = 'ab'.repeat(32);
  const signer = () => ({ machineKey, actor: 'felipesauer' });

  /** Writes n chained (v3) events with plausible per-line hashes. */
  function writeChain(n: number): void {
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(
        JSON.stringify({
          v: 3,
          at: `2026-07-07T00:00:0${i}.000Z`,
          kind: 'task_created',
          actor: 'felipesauer',
          data: { id: `T-${i}` },
          prev_hash: i === 0 ? null : `h${i - 1}`,
          hash: `h${i}`,
        }),
      );
    }
    writeFileSync(path.join(auditDir, 'current.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
  }

  it('emits an artifact that verifies against the committed key with no secret', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    const artifact = emitAttestation(walk, 0, 10, signer(), hmacId);

    expect(artifact.from).toBe(0);
    expect(artifact.to).toBe(10);
    expect(artifact.signerActor).toBe('felipesauer');
    expect(artifact.coveredHeadHash).toBe('h9');

    const resolve = committedSignerResolver(projectRoot);
    const events = walk.chained.slice(0, 10).map((c) => c.event);
    expect(verifyArtifact(artifact, events, resolve)).toEqual({ ok: true });
  });

  it('emits an interior batch [from, to) that verifies over exactly those events', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    const artifact = emitAttestation(walk, 10, 20, signer(), hmacId);
    const resolve = committedSignerResolver(projectRoot);
    const events = walk.chained.slice(10, 20).map((c) => c.event);
    expect(verifyArtifact(artifact, events, resolve)).toEqual({ ok: true });
    // The emitted head is the last event of the batch, not of the whole chain
    // (here they coincide at 20, so check an earlier batch too).
    const midBatch = emitAttestation(walk, 5, 15, signer(), hmacId);
    expect(midBatch.coveredHeadHash).toBe('h14');
  });

  it('a content edit after emission breaks verification', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    const artifact = emitAttestation(walk, 0, 10, signer(), hmacId);
    const resolve = committedSignerResolver(projectRoot);
    const tampered = walk.chained.slice(0, 10).map((c) => c.event);
    tampered[4] = { ...tampered[4], data: { id: 'HACKED' } };
    expect(verifyArtifact(artifact, tampered, resolve).ok).toBe(false);
  });

  it('refuses a range beyond the walked events', () => {
    writeChain(5);
    const walk = walkChainedEvents(auditDir);
    expect(() => emitAttestation(walk, 0, 8, signer(), hmacId)).toThrow(
      /exceeds 5 chained events/i,
    );
  });

  it('an emitted artifact survives the full disk round-trip and still verifies', async () => {
    // The path that actually ships: emit → writeArtifact → re-read → verify.
    // Guards against a serialize/parse bug (base64, from/to coercion, key
    // order) that would break real anonymous verification of a committed .att.
    const store = await import('@/services/audit/attestation-store.js');
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    const artifact = emitAttestation(walk, 0, 10, signer(), hmacId);
    store.writeArtifact(auditDir, artifact);

    const reread = store.listArtifacts(auditDir);
    expect(reread).toHaveLength(1);
    const events = walk.chained.slice(0, 10).map((c) => c.event);
    expect(verifyArtifact(reread[0], events, committedSignerResolver(projectRoot))).toEqual({
      ok: true,
    });
  });

  it('the committed .pub really carries no private key', () => {
    // Guard the invariant at the emission boundary: the file the verifier reads
    // is public-only.
    const pub = readFileSync(machineKey.publicKeyPath(), 'utf-8');
    expect(pub).toContain('PUBLIC KEY');
    expect(pub).not.toContain('PRIVATE KEY');
  });
});
