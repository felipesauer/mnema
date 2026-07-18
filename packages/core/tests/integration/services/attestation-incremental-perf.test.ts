import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { walkChainedEvents, walkChainedTail } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';

/**
 * The checkpoint's attestation walk must cost a function of the NEW batch, not
 * of the whole log. We assert the number of chained events the tail walk
 * PARSES (`observedChained`) is bounded by the batch — flat as the pre-existing
 * attested history grows from 100 to 5000. This is a structural bound, not
 * wall-clock (which would be flaky in a unit test): the incremental walk reads
 * files newest-first and stops once it holds the tail.
 */
describe('incremental attestation is batch-bound (flat in pre-existing size)', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-incr-perf-'));
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

  /**
   * Writes `preexisting` chained events into archived MONTH segments (so they
   * are NOT in current.jsonl), then `batch` fresh events into current.jsonl.
   * Attests all but the fresh tail, mirroring a long-lived log whose history is
   * already committed and rotated away.
   */
  function seed(preexisting: number, batch: number): { headCount: number; coveredTo: number } {
    const total = preexisting + batch;
    // Distribute the pre-existing events across a few archived segments to
    // exercise the reverse file walk skipping whole archived months.
    const perSeg = Math.ceil(preexisting / 3);
    let written = 0;
    let seg = 0;
    while (written < preexisting) {
      const n = Math.min(perSeg, preexisting - written);
      const lines: string[] = [];
      for (let i = 0; i < n; i++) {
        const g = written + i;
        lines.push(line(g));
      }
      writeFileSync(
        path.join(auditDir, `2026-${String(seg + 1).padStart(2, '0')}.jsonl`),
        `${lines.join('\n')}\n`,
        'utf-8',
      );
      written += n;
      seg += 1;
    }
    // The batch lives in current.jsonl.
    const cur: string[] = [];
    for (let i = 0; i < batch; i++) cur.push(line(preexisting + i));
    writeFileSync(path.join(auditDir, 'current.jsonl'), `${cur.join('\n')}\n`, 'utf-8');

    // Attest the pre-existing history in one .att so coveredTo = preexisting.
    if (preexisting > 0) {
      const full = walkChainedEvents(auditDir);
      emitAttestation(full, 0, preexisting, signer(), hmacId);
    }
    return { headCount: total, coveredTo: preexisting };
  }

  function line(g: number): string {
    return JSON.stringify({
      v: 1,
      at: `t-${g}`,
      kind: 'k',
      actor: 'felipesauer',
      data: { id: `T-${g}` },
      prev_hash: g === 0 ? null : `h${g - 1}`,
      hash: `h${g}`,
    });
  }

  it('parses ~batch events for the tail regardless of 100 vs 5000 pre-existing', () => {
    const BATCH = 100;

    const small = seed(100, BATCH);
    const wSmall = walkChainedTail(auditDir, small.headCount, small.coveredTo);
    expect(wSmall.chained.map((c) => c.index)).toEqual(
      Array.from({ length: BATCH }, (_, i) => small.coveredTo + i),
    );
    const smallObserved = wSmall.observedChained;

    // Fresh dir for the large case.
    rmSync(auditDir, { recursive: true, force: true });
    mkdirSync(auditDir, { recursive: true });
    const large = seed(5000, BATCH);
    const wLarge = walkChainedTail(auditDir, large.headCount, large.coveredTo);
    expect(wLarge.chained.map((c) => c.index)).toEqual(
      Array.from({ length: BATCH }, (_, i) => large.coveredTo + i),
    );
    const largeObserved = wLarge.observedChained;

    // The parse count must NOT grow with the pre-existing size. It is bounded
    // by the current.jsonl file (which holds exactly the batch here), so both
    // cases observe the same, batch-sized number of chained events.
    expect(smallObserved).toBe(BATCH);
    expect(largeObserved).toBe(BATCH);
    expect(largeObserved).toBeLessThanOrEqual(smallObserved);
    // And, unambiguously: far below the pre-existing total in the large case.
    expect(largeObserved).toBeLessThan(large.coveredTo);
  });

  it('the full walk, by contrast, parses ALL events (the cost we removed)', () => {
    const { headCount } = seed(5000, 100);
    // The old path parsed everything; assert the contrast so a regression to
    // full-walk in the hot path (proof-of-bite) is measurable.
    const full = walkChainedEvents(auditDir);
    expect(full.chained).toHaveLength(headCount); // 5100 — grows with the log
  });
});
