import { sign as edSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildArtifact, computeLeaf } from '@/services/audit/attestation-artifact.js';
import { attestPath, writeArtifact } from '@/services/audit/attestation-store.js';
import { decideAttLockstep, removeCoveredAtts } from '@/services/audit/prune-att-lockstep.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * The .att lockstep gate (ADR-68 / MNEMA-348). An .att covers events by
 * absolute chained index, and a prune re-indexes the survivors — so an .att
 * over a surviving event would go stale. Fail-closed: remove .att files fully
 * inside the dropped prefix, refuse the prune when any .att straddles the cut
 * or covers a surviving event.
 */
describe('.att prune lockstep', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-att-')), '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(path.dirname(auditDir)), { recursive: true, force: true });
  });

  function signer() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const fingerprint = MachineKeyService.fingerprint(der);
    return { fingerprint, sign: (m: Buffer) => edSign(null, m, privateKey) };
  }

  const hmacId = 'ab'.repeat(32);

  function events(n: number): AuditEvent[] {
    const rows: AuditEvent[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const ev: AuditEvent = {
        v: 1,
        at: `2026-07-07T00:00:0${i}.000Z`,
        kind: 'k',
        actor: 'a',
        data: { id: `T-${i}` },
        prev_hash: prev,
      };
      const hash = computeLeaf(ev).toString('hex');
      prev = hash;
      rows.push({ ...ev, hash });
    }
    return rows;
  }

  /** Commit an .att covering [from, to). */
  function att(evs: AuditEvent[], from: number, to: number): void {
    const s = signer();
    const artifact = buildArtifact({
      events: evs.slice(from, to),
      from,
      to,
      signerActor: 'a',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      sign: s.sign,
    });
    writeArtifact(auditDir, artifact);
  }

  it('removes an .att fully inside the dropped prefix, and does not block', () => {
    const evs = events(10);
    att(evs, 0, 3); // fully below cut=5
    const decision = decideAttLockstep(auditDir, 5);
    expect(decision.blocked).toBe(false);
    expect(decision.toRemove).toEqual([attestPath(auditDir, 3)]);
  });

  it('blocks when an .att straddles the cut', () => {
    const evs = events(10);
    att(evs, 2, 7); // from=2 < cut=5 < to=7 → straddles
    const decision = decideAttLockstep(auditDir, 5);
    expect(decision.blocked).toBe(true);
    expect(decision.blockReason).toMatch(/straddles the cut/i);
  });

  it('blocks when an .att covers only surviving events (indices would shift)', () => {
    const evs = events(10);
    att(evs, 5, 9); // from=5 >= cut=5 → all surviving
    const decision = decideAttLockstep(auditDir, 5);
    expect(decision.blocked).toBe(true);
    expect(decision.blockReason).toMatch(/indices would shift/i);
  });

  it('handles multiple .att: removes those below, blocks on the first surviving one', () => {
    const evs = events(12);
    att(evs, 0, 2); // below
    att(evs, 2, 5); // below (ends exactly at cut)
    att(evs, 5, 9); // surviving → block
    const decision = decideAttLockstep(auditDir, 5);
    expect(decision.blocked).toBe(true);
    // The two below-cut .att are still collected for removal before the block.
    expect(decision.toRemove).toEqual([attestPath(auditDir, 2), attestPath(auditDir, 5)]);
  });

  it('no .att at all: nothing to remove, not blocked', () => {
    const decision = decideAttLockstep(auditDir, 5);
    expect(decision.blocked).toBe(false);
    expect(decision.toRemove).toEqual([]);
  });

  it('an .att ending exactly at the cut is removed (boundary-aligned, not straddling)', () => {
    const evs = events(10);
    att(evs, 0, 5); // to=5 === cut → fully inside dropped prefix
    const decision = decideAttLockstep(auditDir, 5);
    expect(decision.blocked).toBe(false);
    expect(decision.toRemove).toEqual([attestPath(auditDir, 5)]);
  });

  it('removeCoveredAtts deletes the marked files and no .att is left over a removed tail', () => {
    const evs = events(10);
    att(evs, 0, 3);
    const decision = decideAttLockstep(auditDir, 5);
    expect(existsSync(attestPath(auditDir, 3))).toBe(true);
    removeCoveredAtts(decision.toRemove);
    expect(existsSync(attestPath(auditDir, 3))).toBe(false);
  });
});
