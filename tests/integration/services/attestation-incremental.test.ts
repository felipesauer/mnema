import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AttestationArtifact, verifyArtifact } from '@/services/audit/attestation-artifact.js';
import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { planReattest, planReattestIncremental } from '@/services/audit/attestation-reattest.js';
import { committedSignerResolver } from '@/services/audit/attestation-store.js';
import { contentAttestationCheck } from '@/services/audit/attestation-verify.js';
import { walkChainedEvents, walkChainedTail } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';

/**
 * Incremental (tail-only) auto-attestation must be CORRECTNESS-identical to the
 * full-walk plan: same .att bytes for the same tail, a contiguous committed
 * chain (from === previous to), and the same fail-closed refusals for
 * everything that bears on the batch being signed. It differs only in that it
 * parses the tail `[coveredTo, headCount)` rather than the whole chain — the
 * per-artifact crypto re-verification of already-committed batches is deferred
 * to verify time (where the whole chain is walked anyway).
 */
describe('planReattestIncremental (tail-only, fail-closed)', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-incr-'));
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
  const resolver = () => committedSignerResolver(projectRoot);

  /** Writes `n` chained events to current.jsonl (hashes chained h0..h{n-1}). */
  function writeChain(n: number): void {
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(
        JSON.stringify({
          v: 3,
          at: `2026-07-07T00:00:00.${String(i).padStart(3, '0')}Z`,
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

  /** Runs the incremental plan the way autoAttest does: coveredTo → tail walk. */
  function incremental(
    existing: readonly AttestationArtifact[],
    overrides: Partial<Parameters<typeof planReattestIncremental>[0]> = {},
  ) {
    const headCount = walkChainedEvents(auditDir).chained.length;
    const coveredTo = existing.reduce((m, a) => (a.to > m ? a.to : m), 0);
    const walk = walkChainedTail(auditDir, headCount, coveredTo);
    return planReattestIncremental({
      walk,
      headCount,
      existing,
      signer: signer(),
      projectHmacId: hmacId,
      chainHealthy: true,
      signedEventCountAt: null,
      ...overrides,
    });
  }

  it('emits the whole tail on a fresh chain, from 0, contiguous', () => {
    writeChain(10);
    const plan = incremental([]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.artifacts).toHaveLength(1);
    expect([plan.artifacts[0].from, plan.artifacts[0].to]).toEqual([0, 10]);
  });

  it('attest batch 1, add events, attest batch 2 — the two .att are CONTIGUOUS and verify as one chain', () => {
    // Batch 1: events [0,10).
    writeChain(10);
    const p1 = incremental([]);
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    const att1 = p1.artifacts[0];
    expect([att1.from, att1.to]).toEqual([0, 10]);

    // More events accrue; batch 2 must start exactly where batch 1 ended.
    writeChain(25);
    const p2 = incremental([att1]);
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    expect(p2.artifacts).toHaveLength(1);
    const att2 = p2.artifacts[0];
    // Contiguity: no gap, no overlap.
    expect(att2.from).toBe(att1.to);
    expect([att2.from, att2.to]).toEqual([10, 25]);

    // The two .att verify as one continuous, gap-free chain over all 25 events.
    const walk = walkChainedEvents(auditDir);
    const verdict = contentAttestationCheck(walk, [att1, att2], resolver(), hmacId);
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toMatch(/all 25 chained events attested/);
  });

  it('byte-identical to the full-walk emit for the same tail', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    const att1 = emitAttestation(walk, 0, 10, signer(), hmacId);

    // Full-walk plan for the tail.
    const full = planReattest({
      walk,
      existing: [att1],
      resolvePublicKeyPem: resolver(),
      signer: signer(),
      projectHmacId: hmacId,
      chainHealthy: true,
      signedEventCountAt: null,
    });
    // Incremental plan for the same tail.
    const incr = incremental([att1]);
    expect(full.ok && incr.ok).toBe(true);
    if (!full.ok || !incr.ok) return;
    // Same range, and byte-for-byte identical signed artifact.
    expect(incr.artifacts).toHaveLength(1);
    expect(full.artifacts).toHaveLength(1);
    expect(incr.artifacts[0]).toEqual(full.artifacts[0]);
  });

  it('is a no-op when the chain is fully attested (writes nothing)', () => {
    writeChain(10);
    const att = emitAttestation(walkChainedEvents(auditDir), 0, 10, signer(), hmacId);
    const plan = incremental([att]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.artifacts).toHaveLength(0);
    expect(plan.planned).toHaveLength(0);
  });

  it('splits a large NEW tail into fixed-size batches, still contiguous', () => {
    writeChain(10);
    const att = emitAttestation(walkChainedEvents(auditDir), 0, 10, signer(), hmacId);
    writeChain(260);
    const plan = incremental([att], { batchSize: 100 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Tail [10,260) → [10,110), [110,210), [210,260); each from === prev to.
    expect(plan.artifacts.map((a) => [a.from, a.to])).toEqual([
      [10, 110],
      [110, 210],
      [210, 260],
    ]);
  });

  it('refuses when the chain is not internally consistent (chainHealthy false)', () => {
    writeChain(10);
    const plan = incremental([], { chainHealthy: false });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/not internally consistent/i);
  });

  it('refuses a GAP in .att coverage (missing middle artifact)', () => {
    // Two .att [0,10) and [20,30) with [10,20) missing → discontiguous.
    writeChain(40);
    const walk = walkChainedEvents(auditDir);
    const a = emitAttestation(walk, 0, 10, signer(), hmacId);
    const c = emitAttestation(walk, 20, 30, signer(), hmacId);
    const plan = incremental([a, c]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/discontiguous/i);
  });

  it('refuses a truncation (chain shorter than an .att covers)', () => {
    // .att covers [0,20) but disk now holds only 10 chained events.
    writeChain(20);
    const att = emitAttestation(walkChainedEvents(auditDir), 0, 20, signer(), hmacId);
    writeChain(10); // truncate on disk
    const plan = incremental([att]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/not present on disk|truncat/i);
  });

  it('refuses a truncation below a signed checkpoint', () => {
    writeChain(5);
    const plan = incremental([], { signedEventCountAt: 8 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/truncation/i);
  });

  it('refuses (not throws) on a malformed line inside the tail being signed', () => {
    writeChain(5);
    writeFileSync(path.join(auditDir, 'current.jsonl'), 'garbage not json\n', { flag: 'a' });
    // headCount here is 5 (malformed line is not chained); tail walk sees the
    // garbage line and refuses rather than emitting over it.
    const walk = walkChainedTail(auditDir, 5, 0);
    const plan = planReattestIncremental({
      walk,
      headCount: 5,
      existing: [],
      signer: signer(),
      projectHmacId: hmacId,
      chainHealthy: true,
      signedEventCountAt: null,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/unparseable/i);
  });

  it('refuses to emit when no signer identity is resolvable', () => {
    writeChain(10);
    const plan = incremental([], { signer: null });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/no signing identity/i);
  });

  it('a tampered event inside an ATTESTED range is caught at verify time', () => {
    // Incremental emit extends coverage; the tamper of an already-attested
    // event is caught by contentAttestationCheck (whole-chain), same as before.
    writeChain(20);
    const att1 = emitAttestation(walkChainedEvents(auditDir), 0, 10, signer(), hmacId);
    // Attest the tail incrementally.
    const p2 = incremental([att1]);
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const att2 = p2.artifacts[0];

    // Now tamper an event INSIDE att1's range and re-walk.
    const tampered = walkChainedEvents(auditDir);
    const tamperedEvents = tampered.chained.map((c) => c.event);
    // Recompute att1 over the tampered event 3 → its verdict must flip to red.
    const eventsForAtt1 = tamperedEvents
      .slice(0, 10)
      .map((e, i) =>
        i === 3 ? { ...e, data: { ...(e as { data: unknown }).data, injected: true } } : e,
      );
    const verdict = verifyArtifact(att1, eventsForAtt1, resolver());
    expect(verdict.ok).toBe(false);
    // And the emitted tail att2 still verifies over its own (untampered) events.
    const att2Events = tamperedEvents.slice(att2.from, att2.to);
    expect(verifyArtifact(att2, att2Events, resolver()).ok).toBe(true);
  });

  it('preserves absolute indexing across a rotated segment (tail spans files)', () => {
    // Archived month + current: the incremental tail walk must assign absolute
    // indices continuous across the boundary, so a batch that straddles the
    // rotation emits with the same from/to the full walk would.
    const seg = (name: string, base: number, n: number) => {
      const lines: string[] = [];
      for (let i = 0; i < n; i++) {
        const g = base + i;
        lines.push(
          JSON.stringify({
            v: 3,
            at: `t-${g}`,
            kind: 'k',
            actor: 'felipesauer',
            data: { id: `T-${g}` },
            prev_hash: g === 0 ? null : `h${g - 1}`,
            hash: `h${g}`,
          }),
        );
      }
      writeFileSync(path.join(auditDir, name), `${lines.join('\n')}\n`, 'utf-8');
    };
    seg('2026-06.jsonl', 0, 8); // events 0..7 archived
    seg('current.jsonl', 8, 7); // events 8..14 current
    const headCount = walkChainedEvents(auditDir).chained.length; // 15
    expect(headCount).toBe(15);
    // Attest batch [0,5) first, then incrementally attest the tail [5,15).
    const att1 = emitAttestation(walkChainedEvents(auditDir), 0, 5, signer(), hmacId);
    const walk = walkChainedTail(auditDir, headCount, 5);
    // The tail walk must hold events 5..14 with absolute indices.
    expect(walk.chained.map((c) => c.index)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const plan = planReattestIncremental({
      walk,
      headCount,
      existing: [att1],
      signer: signer(),
      projectHmacId: hmacId,
      chainHealthy: true,
      signedEventCountAt: null,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect([plan.artifacts[0].from, plan.artifacts[0].to]).toEqual([5, 15]);
    // Verify the two .att as one chain over the whole (rotated) log.
    const verdict = contentAttestationCheck(
      walkChainedEvents(auditDir),
      [att1, plan.artifacts[0]],
      resolver(),
      hmacId,
    );
    expect(verdict.ok).toBe(true);
  });
});
