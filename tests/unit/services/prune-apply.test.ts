import { sign as edSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyPrune, buildPrunePlan, PrunePlanError } from '@/services/audit/prune-apply.js';
import { pruneWaiverPath, readPruneWaiver } from '@/services/audit/prune-store.js';
import { verifyPruneWaiver } from '@/services/audit/prune-waiver.js';
import { computeCutPoint } from '@/services/audit/retention-cut-point.js';
import { assessAuditChain } from '@/services/integrity/audit-integrity.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { hashEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * The prune apply step (ADR-68 / MNEMA-347): delete the dropped segments, sign
 * a prune waiver over them while they still exist, reconcile the event_count
 * down, re-sign the head. The end-to-end property is the one that matters: a
 * chain pruned this way verifies CLEAN via the walk's re-baseline gate (with
 * the waiver's anchor), and a bare delete without the waiver would not.
 */
describe('prune apply', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-apply-')), '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(path.dirname(auditDir)), { recursive: true, force: true });
  });

  function signer() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const fingerprint = MachineKeyService.fingerprint(der);
    return { fingerprint, pem, sign: (m: Buffer) => edSign(null, m, privateKey) };
  }

  /** A single continuous v2 chain; each event's hash chains to the prior. */
  function makeChain(n: number): AuditEvent[] {
    const rows: AuditEvent[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const base: AuditEvent = {
        v: 2,
        at: `2026-07-07T00:00:${String(i).padStart(2, '0')}.000Z`,
        kind: 'task_created',
        actor: 'felipesauer',
        data: { id: `T-${i}` },
        prev_hash: prev,
      };
      const hash = hashEvent(base);
      rows.push({ ...base, hash });
      prev = hash;
    }
    return rows;
  }

  function writeSegment(name: string, evs: AuditEvent[]): void {
    writeFileSync(
      path.join(auditDir, name),
      `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf-8',
    );
  }

  const hmacId = 'ab'.repeat(32);
  const NOW = new Date('2026-07-16T12:00:00.000Z');

  /** Lay out a chain across two old months + current, older than the window. */
  function layout(): { chain: AuditEvent[] } {
    const chain = makeChain(9);
    writeSegment('2024-01.jsonl', chain.slice(0, 3)); // dropped
    writeSegment('2024-02.jsonl', chain.slice(3, 5)); // dropped
    writeSegment('2026-07.jsonl', chain.slice(5, 8)); // kept
    writeSegment('current.jsonl', chain.slice(8)); // kept
    return { chain };
  }

  it('prunes, signs a waiver, and the pruned chain verifies clean via the re-baseline', () => {
    const { chain } = layout();
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(cut.hasCut).toBe(true);
    expect(cut.keepFromIndex).toBe(5); // 3 + 2 dropped

    const plan = buildPrunePlan(auditDir, cut);
    expect(plan.keptEventCount).toBe(4);
    expect(plan.genesisHash).toBe(chain[5].hash);
    expect(plan.survivingHeadHash).toBe(chain[8].hash);

    let reconciled: { count: number; head: string } | null = null;
    const s = signer();
    const { waiver, reSigned } = applyPrune({
      auditDir,
      plan,
      droppedFiles: cut.dropped.map((d) => d.file),
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      sign: s.sign,
      forceReconcile: (count, head) => {
        reconciled = { count, head };
      },
      reSignHead: () => true,
      now: () => NOW,
    });

    // The dropped segment files are gone; the kept ones remain.
    expect(existsSync(path.join(auditDir, '2024-01.jsonl'))).toBe(false);
    expect(existsSync(path.join(auditDir, '2024-02.jsonl'))).toBe(false);
    expect(existsSync(path.join(auditDir, '2026-07.jsonl'))).toBe(true);
    expect(existsSync(path.join(auditDir, 'current.jsonl'))).toBe(true);

    // Reconcile was asked for the surviving count/head; head was re-signed.
    expect(reconciled).toEqual({ count: 4, head: chain[8].hash });
    expect(reSigned).toBe(true);

    // The waiver is committed and its anchor binds to the surviving genesis.
    expect(existsSync(pruneWaiverPath(auditDir))).toBe(true);
    expect(waiver.genesisHash).toBe(chain[5].hash);
    expect(waiver.cut).toBe(5);

    // END-TO-END: the pruned chain now verifies CLEAN, but only WITH the
    // re-baseline the waiver authorises.
    const resolve = (fp: string) => (fp === s.fingerprint ? s.pem : null);
    const stored = readPruneWaiver(auditDir);
    expect(stored).not.toBeNull();
    const genesisOnDisk = chain[5].hash as string;
    expect(verifyPruneWaiver(stored as never, genesisOnDisk, hmacId, resolve)).toEqual({
      ok: true,
    });

    // The surviving genesis's prev_hash on disk is the PRUNED HEAD hash (the
    // last dropped event) — the prune does not rewrite it (no cascade re-hash).
    // So the walk matches against prunedHeadHash; the anchor digest is the
    // waiver's separate content attestation of the deleted prefix.
    const clean = assessAuditChain(auditDir, null, {
      anchorPrevHash: waiver.prunedHeadHash,
      genesisHash: waiver.genesisHash,
    });
    expect(clean.chainBroken).toBe(false);
    expect(clean.chainedLines).toBe(4);
    expect(waiver.prunedHeadHash).toBe(chain[4].hash);

    // And a BARE assess (no re-baseline) still reads the deleted prefix as tamper.
    const bare = assessAuditChain(auditDir, null);
    expect(bare.chainBroken).toBe(true);
  });

  it('writes the waiver LAST — after reconcile and re-sign', () => {
    const { chain } = layout();
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    const plan = buildPrunePlan(auditDir, cut);
    const order: string[] = [];
    const s = signer();
    applyPrune({
      auditDir,
      plan,
      droppedFiles: cut.dropped.map((d) => d.file),
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      sign: s.sign,
      forceReconcile: () => order.push('reconcile'),
      reSignHead: () => {
        order.push('resign');
        return true;
      },
      now: () => NOW,
    });
    order.push('waiver-on-disk:' + String(existsSync(pruneWaiverPath(auditDir))));
    expect(order).toEqual(['reconcile', 'resign', 'waiver-on-disk:true']);
    void chain;
  });

  it('reports reSigned=false when no signer is available (no crash)', () => {
    layout();
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    const plan = buildPrunePlan(auditDir, cut);
    const s = signer();
    const { reSigned } = applyPrune({
      auditDir,
      plan,
      droppedFiles: cut.dropped.map((d) => d.file),
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      sign: s.sign,
      forceReconcile: () => {},
      reSignHead: () => false, // no machine key on this host
      now: () => NOW,
    });
    expect(reSigned).toBe(false);
    // Waiver is still written — an anonymous verifier relies on it.
    expect(existsSync(pruneWaiverPath(auditDir))).toBe(true);
  });

  it('buildPrunePlan refuses a cut with no cut point', () => {
    layout();
    const noCut = computeCutPoint(auditDir, 'full', 12, NOW);
    expect(() => buildPrunePlan(auditDir, noCut)).toThrow(PrunePlanError);
  });

  it('buildPrunePlan refuses when a malformed line is on disk', () => {
    const chain = makeChain(6);
    writeSegment('2024-01.jsonl', chain.slice(0, 3));
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${chain
        .slice(3)
        .map((e) => JSON.stringify(e))
        .join('\n')}\nnot json\n`,
      'utf-8',
    );
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(() => buildPrunePlan(auditDir, cut)).toThrow(/unparseable/i);
  });

  it('the committed waiver JSON is stable (pretty, trailing newline)', () => {
    layout();
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    const plan = buildPrunePlan(auditDir, cut);
    const s = signer();
    applyPrune({
      auditDir,
      plan,
      droppedFiles: cut.dropped.map((d) => d.file),
      signerActor: 'felipesauer',
      signerFingerprint: s.fingerprint,
      projectHmacId: hmacId,
      sign: s.sign,
      forceReconcile: () => {},
      reSignHead: () => true,
      now: () => NOW,
    });
    const raw = readFileSync(pruneWaiverPath(auditDir), 'utf-8');
    expect(raw.endsWith('}\n')).toBe(true);
    expect(raw).toContain('"version": "mnema-prune/v1"');
  });
});
