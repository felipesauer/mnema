import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { committedSignerResolver } from '@/services/audit/attestation-store.js';
import { contentAttestationCheck } from '@/services/audit/attestation-verify.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/machine-key.js';

/**
 * The fail-closed content-attestation verdict: ok ONLY when every chained
 * event is covered by a verifying .att; an unattested tail, a gap, a
 * truncation, a non-verifying .att, or a missing signer key are all ok:false,
 * so the doctor/audit_verify every(ok) collapse cannot show green over them.
 */
describe('contentAttestationCheck (fail-closed verdict)', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attest-verify-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    machineKey.getOrCreate();
  });
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  const hmacId = 'ab'.repeat(32);
  const signer = () => ({ machineKey, actor: 'felipesauer' });

  function writeChain(n: number): void {
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(
        JSON.stringify({
          v: 3,
          at: `2026-07-07T00:00:0${i}.000Z`,
          kind: 'k',
          actor: 'felipesauer',
          data: { id: `T-${i}` },
          prev_hash: i === 0 ? null : `h${i - 1}`,
          hash: `h${i}`,
        }),
      );
    }
    writeFileSync(path.join(auditDir, 'current.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
  }

  const resolve = () => committedSignerResolver(projectRoot);

  it('ok when every chained event is attested', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    const att = emitAttestation(walk, 0, 10, signer(), hmacId);
    const check = contentAttestationCheck(walk, [att], resolve());
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/all 10 chained events attested/i);
    expect(check.detail).toMatch(/signed by felipesauer/i);
  });

  it('warns (never green) on an unattested tail', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    const att = emitAttestation(walk, 0, 10, signer(), hmacId); // only first half
    const check = contentAttestationCheck(walk, [att], resolve());
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.detail).toMatch(/10 tail event\(s\) unattested/i);
  });

  it('is dormant (ok, warning) when no attestations exist — opt-in, not a failure', () => {
    // No .att is non-adoption, not tampering; ok:true so a project that never
    // ran reattest is not reported "not intact". Fail-closed starts once a
    // .att exists (covered by the other cases).
    writeChain(10);
    const check = contentAttestationCheck(walkChainedEvents(auditDir), [], resolve());
    expect(check.ok).toBe(true);
    expect(check.severity).toBe('warning');
    expect(check.detail).toMatch(/not yet attested/i);
  });

  it('errors on a .att whose content does not verify (tamper)', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    const att = emitAttestation(walk, 0, 10, signer(), hmacId);
    const tampered = { ...att, contentRoot: 'deadbeef' };
    const check = contentAttestationCheck(walk, [tampered], resolve());
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('error');
  });

  it('warns (cannot attest) when the signer key is absent', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    const att = emitAttestation(walk, 0, 10, signer(), hmacId);
    // Resolver that knows no keys → cannot attest, not tamper.
    const check = contentAttestationCheck(walk, [att], () => null);
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.detail).toMatch(/not present|cannot attest/i);
  });

  it('errors on an interior gap between attestations', () => {
    writeChain(30);
    const walk = walkChainedEvents(auditDir);
    const a = emitAttestation(walk, 0, 10, signer(), hmacId);
    const c = emitAttestation(walk, 20, 30, signer(), hmacId); // gap [10,20)
    const check = contentAttestationCheck(walk, [a, c], resolve());
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('error');
    expect(check.detail).toMatch(/gap: events \[10, 20\)/i);
  });

  it('errors when a .att covers events not on disk (truncation)', () => {
    writeChain(20);
    const walk20 = walkChainedEvents(auditDir);
    const att = emitAttestation(walk20, 0, 20, signer(), hmacId);
    // Now the disk chain shrinks to 10 (truncation) but the .att still claims 20.
    writeChain(10);
    const walk10 = walkChainedEvents(auditDir);
    const check = contentAttestationCheck(walk10, [att], resolve());
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('error');
    expect(check.detail).toMatch(/truncated below attested history/i);
  });

  it('reports multiple signing machines when the chain changes owner', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    const userDirB = path.join(tempRoot, 'home-b', '.config', 'mnema');
    mkdirSync(userDirB, { recursive: true });
    const keyB = new MachineKeyService(projectRoot, 'other-dev', userDirB);
    keyB.getOrCreate();
    const a = emitAttestation(walk, 0, 10, signer(), hmacId);
    const b = emitAttestation(walk, 10, 20, { machineKey: keyB, actor: 'other-dev' }, hmacId);
    const check = contentAttestationCheck(walk, [a, b], resolve());
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/2 machines \(felipesauer, other-dev\)/i);
  });
});
