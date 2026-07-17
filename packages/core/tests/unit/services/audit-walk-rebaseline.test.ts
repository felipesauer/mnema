import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assessAuditChain } from '@/services/integrity/audit-integrity.js';
import { hmacEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const FIXTURE_SECRET = Buffer.alloc(32, 7);

/**
 * The walk's prune re-baseline gate (ADR-68 / MNEMA-346). After a retention
 * prune deletes the oldest segments, the surviving genesis's prev_hash points
 * at the committed anchor digest, not at a hash on disk. Normally that is a
 * hard `prev_hash break (a prior segment may be missing)` — tamper. When a
 * caller passes a PRE-VERIFIED AcceptedRebaseline (the waiver's signature,
 * project pin, and genesis match were already checked in prune-waiver.ts), the
 * walk accepts the genesis and reports a clean chain. Without it, the same disk
 * still reads as tamper.
 */
describe('walk prune re-baseline gate', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-rebase-')), '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(path.dirname(auditDir)), { recursive: true, force: true });
  });

  /**
   * A v2 (keyless SHA-256) chain of `n` events whose first event's prev_hash is
   * `genesisPrev` (the anchor digest after a prune, or null for a real
   * genesis). Each event carries the hash the integrity walk recomputes, so the
   * chain is internally consistent.
   */
  function chain(n: number, genesisPrev: string | null): AuditEvent[] {
    const rows: AuditEvent[] = [];
    let prev: string | null = genesisPrev;
    for (let i = 0; i < n; i++) {
      const base: AuditEvent = {
        v: 1,
        at: `2026-07-07T00:00:0${i}.000Z`,
        kind: 'task_created',
        actor: 'felipesauer',
        data: { id: `T-${i}` },
        prev_hash: prev,
      };
      const hash = hmacEvent(base, FIXTURE_SECRET);
      rows.push({ ...base, hash });
      prev = hash;
    }
    return rows;
  }

  function writeChain(evs: AuditEvent[]): void {
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf-8',
    );
  }

  // The hash the surviving genesis's prev_hash carries on disk after a prune —
  // the last dropped event's hash (the waiver's prunedHeadHash), NOT the anchor
  // digest. The prune does not rewrite the genesis, so this is what the walk
  // matches against.
  const anchor = 'ab'.repeat(32);

  it('flags a re-baselined genesis as tamper WITHOUT an accepted re-baseline', () => {
    // The surviving genesis chains back to the anchor digest (a hash not on
    // disk) — with no waiver this is the classic "prior segment may be missing".
    const evs = chain(3, anchor);
    writeChain(evs);
    const bare = assessAuditChain(auditDir, null);
    expect(bare.chainBroken).toBe(true);
    expect(bare.chainBreakDetail).toMatch(/prior segment may be missing/i);
  });

  it('accepts the re-baselined genesis WITH a matching accepted re-baseline', () => {
    const evs = chain(3, anchor);
    writeChain(evs);
    const genesisHash = evs[0].hash as string;
    const ok = assessAuditChain(auditDir, null, { anchorPrevHash: anchor, genesisHash });
    expect(ok.chainBroken).toBe(false);
    expect(ok.chainedLines).toBe(3);
  });

  it('rejects a re-baseline whose anchor prev_hash does not match the disk genesis prev', () => {
    const evs = chain(3, anchor);
    writeChain(evs);
    const genesisHash = evs[0].hash as string;
    // Waiver claims a different anchor than the one the genesis actually points
    // at — the gate must not accept it.
    const bad = assessAuditChain(auditDir, null, {
      anchorPrevHash: 'cd'.repeat(32),
      genesisHash,
    });
    expect(bad.chainBroken).toBe(true);
  });

  it('rejects a re-baseline whose genesis hash does not match the disk genesis', () => {
    const evs = chain(3, anchor);
    writeChain(evs);
    // Correct anchor, but the waiver names a different genesis event — reject.
    const bad = assessAuditChain(auditDir, null, {
      anchorPrevHash: anchor,
      genesisHash: 'deadbeef',
    });
    expect(bad.chainBroken).toBe(true);
  });

  it('never accepts a re-baseline at an INTERIOR break, only at the genesis', () => {
    // A genuine genesis (prev_hash null) followed by an interior break: an
    // attacker rewrote event 1's prev_hash to the anchor. Even if a waiver
    // named that break's hashes, the gate only fires at the first chained
    // event, so the interior break stays tamper.
    const evs = chain(3, null);
    const tampered = evs.map((e, i) => (i === 1 ? { ...e, prev_hash: anchor } : e)) as AuditEvent[];
    writeChain(tampered);
    const genesis1 = tampered[1].hash as string;
    const attempt = assessAuditChain(auditDir, null, {
      anchorPrevHash: anchor,
      genesisHash: genesis1,
    });
    expect(attempt.chainBroken).toBe(true);
  });

  it('a real genesis (prev_hash null) is unaffected by an accepted re-baseline', () => {
    const evs = chain(3, null);
    writeChain(evs);
    // Passing a re-baseline that does not describe this (null-prev) genesis must
    // not break a chain that was already clean.
    const ok = assessAuditChain(auditDir, null, {
      anchorPrevHash: anchor,
      genesisHash: evs[0].hash as string,
    });
    expect(ok.chainBroken).toBe(false);
    expect(ok.chainedLines).toBe(3);
  });

  it('an anonymous verifier (no secret) accepts the re-baseline via the boundary hashes alone', () => {
    // v2 lines need no secret; the point is the gate does not depend on the
    // HMAC secret — an anonymous clone verifies the re-baseline structurally.
    const evs = chain(4, anchor);
    writeChain(evs);
    const ok = assessAuditChain(auditDir, null, {
      anchorPrevHash: anchor,
      genesisHash: evs[0].hash as string,
    });
    expect(ok.chainBroken).toBe(false);
    expect(ok.chainedLines).toBe(4);
  });

  it('accepts a re-baselined genesis that lives in an archived segment, spanning rotation', () => {
    // After a prune the surviving genesis is the first event of the oldest
    // KEPT archived month, with current.jsonl chaining on. The gate fires at
    // the first chained event across the whole walk, so a re-baseline in an
    // archived segment is accepted and the chain reads clean across rotation.
    const evs = chain(4, anchor);
    writeFileSync(
      path.join(auditDir, '2026-06.jsonl'),
      `${evs
        .slice(0, 2)
        .map((e) => JSON.stringify(e))
        .join('\n')}\n`,
      'utf-8',
    );
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${evs
        .slice(2)
        .map((e) => JSON.stringify(e))
        .join('\n')}\n`,
      'utf-8',
    );
    const ok = assessAuditChain(auditDir, null, {
      anchorPrevHash: anchor,
      genesisHash: evs[0].hash as string,
    });
    expect(ok.chainBroken).toBe(false);
    expect(ok.chainedLines).toBe(4);
  });
});
