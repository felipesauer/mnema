import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeCutPoint, listAuditSegments } from '@/services/audit/retention-cut-point.js';
import { EVENT_FORMAT_VERSION } from '@/storage/audit/audit-hash.js';

/**
 * The retention cut-point math (ADR-68). Pure segment-boundary arithmetic:
 * given the on-disk segments, a strategy, N months, and "now", decide which
 * archived months fall below the retention window and the chained-event index
 * the surviving chain would re-baseline onto. It never deletes or signs.
 */
describe('computeCutPoint', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-cut-')), '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(path.dirname(auditDir)), { recursive: true, force: true });
  });

  /** Writes chained (keyed) events as lines to a segment file. */
  function segment(name: string, count: number): void {
    const lines = Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        v: EVENT_FORMAT_VERSION,
        at: `t-${i}`,
        kind: 'k',
        actor: 'a',
        data: { i },
        hash: `${name}-${i}`,
      }),
    );
    writeFileSync(path.join(auditDir, name), `${lines.join('\n')}\n`, 'utf-8');
  }

  // Reference "now" is 2026-07 (July). A 12-month window keeps 2025-08..2026-07.
  const NOW = new Date('2026-07-16T12:00:00.000Z');

  it('full never produces a cut, even with old months present', () => {
    segment('2020-01.jsonl', 3);
    segment('current.jsonl', 2);
    const cut = computeCutPoint(auditDir, 'full', 12, NOW);
    expect(cut.hasCut).toBe(false);
    expect(cut.dropped).toEqual([]);
    expect(cut.keepFromIndex).toBe(0);
    expect(cut.keptEventCount).toBe(5);
  });

  it('recent and local compute the SAME cut for a given N', () => {
    // 2024-12 and 2025-06 are older than the 2025-08 window start → dropped.
    segment('2024-12.jsonl', 4);
    segment('2025-06.jsonl', 3);
    segment('2026-01.jsonl', 5);
    segment('current.jsonl', 2);
    const recent = computeCutPoint(auditDir, 'recent', 12, NOW);
    const local = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(recent.hasCut).toBe(true);
    expect(recent.keepFromIndex).toBe(local.keepFromIndex);
    expect(recent.keptEventCount).toBe(local.keptEventCount);
    expect(recent.dropped.map((s) => s.month)).toEqual(local.dropped.map((s) => s.month));
    // Dropped 4 + 3 = 7 events; kept 5 + 2 = 7.
    expect(recent.keepFromIndex).toBe(7);
    expect(recent.keptEventCount).toBe(7);
    expect(recent.dropped.map((s) => s.month)).toEqual(['2024-12', '2025-06']);
  });

  it('the cut lands on a segment boundary — a segment is dropped whole', () => {
    segment('2024-01.jsonl', 10);
    segment('2026-07.jsonl', 4);
    segment('current.jsonl', 1);
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    // keepFromIndex is exactly the dropped segment's chained count, never a
    // mid-segment index.
    expect(cut.keepFromIndex).toBe(10);
    expect(cut.kept.map((s) => s.month)).toEqual(['2026-07', null]);
  });

  it('current.jsonl is never dropped, whatever its (implicit) month', () => {
    segment('current.jsonl', 3);
    const cut = computeCutPoint(auditDir, 'local', 1, NOW);
    expect(cut.hasCut).toBe(false);
    expect(cut.kept.map((s) => s.month)).toEqual([null]);
  });

  it('N larger than history keeps everything', () => {
    segment('2025-01.jsonl', 2);
    segment('current.jsonl', 1);
    const cut = computeCutPoint(auditDir, 'local', 240, NOW);
    expect(cut.hasCut).toBe(false);
    expect(cut.keptEventCount).toBe(3);
  });

  it('an absurdly large N never underflows the window month key', () => {
    // A retention window larger than the whole calendar must clamp to "keep
    // everything", not produce a negative/malformed month that breaks the
    // string comparison.
    segment('2020-01.jsonl', 2);
    segment('current.jsonl', 1);
    const cut = computeCutPoint(auditDir, 'local', 10_000_000, NOW);
    expect(cut.hasCut).toBe(false);
    expect(cut.keptEventCount).toBe(3);
  });

  it('N clamps to at least 1 (0 does not drop the current month)', () => {
    segment('2026-06.jsonl', 2);
    segment('current.jsonl', 1);
    // retentionMonths 0 clamps to 1 → window is just 2026-07; 2026-06 drops.
    const cut = computeCutPoint(auditDir, 'local', 0, NOW);
    expect(cut.hasCut).toBe(true);
    expect(cut.dropped.map((s) => s.month)).toEqual(['2026-06']);
    expect(cut.keepFromIndex).toBe(2);
  });

  it('empty history has no cut', () => {
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(cut.hasCut).toBe(false);
    expect(cut.dropped).toEqual([]);
    expect(cut.kept).toEqual([]);
    expect(cut.keptEventCount).toBe(0);
  });

  it('history entirely inside the window has no cut', () => {
    segment('2026-03.jsonl', 4);
    segment('2026-07.jsonl', 2);
    segment('current.jsonl', 1);
    const cut = computeCutPoint(auditDir, 'recent', 12, NOW);
    expect(cut.hasCut).toBe(false);
    expect(cut.keptEventCount).toBe(7);
  });

  it('a segment whose name does not parse to a month is kept, never silently dropped', () => {
    // A stray non-YYYY-MM .jsonl must not be treated as ancient and pruned.
    segment('weird-name.jsonl', 2);
    segment('current.jsonl', 1);
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(cut.hasCut).toBe(false);
  });

  it('window boundary is inclusive: the window-start month is kept', () => {
    // 12-month window ending 2026-07 starts at 2025-08. 2025-08 is kept;
    // 2025-07 (one earlier) is dropped.
    segment('2025-07.jsonl', 3);
    segment('2025-08.jsonl', 2);
    segment('current.jsonl', 1);
    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(cut.dropped.map((s) => s.month)).toEqual(['2025-07']);
    expect(cut.kept.map((s) => s.month)).toEqual(['2025-08', null]);
    expect(cut.keepFromIndex).toBe(3);
  });
});

describe('listAuditSegments', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-seg-')), '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(path.dirname(auditDir)), { recursive: true, force: true });
  });

  function segment(name: string, count: number): void {
    const lines = Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        v: EVENT_FORMAT_VERSION,
        at: `t-${i}`,
        kind: 'k',
        actor: 'a',
        data: { i },
        hash: `${name}-${i}`,
      }),
    );
    writeFileSync(path.join(auditDir, name), `${lines.join('\n')}\n`, 'utf-8');
  }

  it('lists segments oldest-first with current last, counting chained events', () => {
    segment('2026-06.jsonl', 2);
    segment('2026-05.jsonl', 3);
    segment('current.jsonl', 1);
    const segs = listAuditSegments(auditDir);
    expect(segs.map((s) => s.month)).toEqual(['2026-05', '2026-06', null]);
    expect(segs.map((s) => s.chainedEvents)).toEqual([3, 2, 1]);
  });

  it('does not count non-keyed or malformed lines as chained', () => {
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      [
        JSON.stringify({
          v: EVENT_FORMAT_VERSION,
          at: 't',
          kind: 'k',
          actor: 'a',
          data: {},
          hash: 'A',
        }),
        JSON.stringify({ v: 0, at: 't', kind: 'k', actor: 'a', data: {} }),
        'not json',
        JSON.stringify({
          v: EVENT_FORMAT_VERSION,
          at: 't',
          kind: 'k',
          actor: 'a',
          data: {},
          hash: 'B',
        }),
      ].join('\n'),
      'utf-8',
    );
    expect(listAuditSegments(auditDir)[0]?.chainedEvents).toBe(2);
  });
});
