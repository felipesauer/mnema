import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { orderedAuditFiles } from '@/storage/audit/audit-files.js';

/**
 * Pins the single source of truth for audit-file ordering that both the
 * integrity walk and the query reader consume. The chain is
 * `[oldest month … newest month, current]`; `current.jsonl` must always
 * come last, even when a segment name would sort after it lexically —
 * the exact case where the old duplicated `.sort()` in audit-query
 * disagreed with the integrity ordering.
 */
describe('orderedAuditFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-audit-files-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function touch(name: string): void {
    writeFileSync(path.join(dir, name), '', 'utf-8');
  }

  it('keeps current.jsonl last even past a segment that sorts after it', () => {
    // "zzz.jsonl" sorts AFTER "current.jsonl" lexicographically. A plain
    // sort would put current before zzz; the chain order must not.
    touch('2026-01.jsonl');
    touch('current.jsonl');
    touch('zzz.jsonl');

    const ordered = orderedAuditFiles(dir).map((p) => path.basename(p));
    expect(ordered).toEqual(['2026-01.jsonl', 'zzz.jsonl', 'current.jsonl']);
    // A raw lexicographic sort — the pre-fix behaviour — would disagree:
    expect([...ordered].sort()).not.toEqual(ordered);
  });

  it('orders archived months oldest-first with current last', () => {
    touch('2026-03.jsonl');
    touch('2026-01.jsonl');
    touch('2026-02.jsonl');
    touch('current.jsonl');

    expect(orderedAuditFiles(dir).map((p) => path.basename(p))).toEqual([
      '2026-01.jsonl',
      '2026-02.jsonl',
      '2026-03.jsonl',
      'current.jsonl',
    ]);
  });

  it('handles only current.jsonl', () => {
    touch('current.jsonl');
    expect(orderedAuditFiles(dir).map((p) => path.basename(p))).toEqual(['current.jsonl']);
  });

  it('handles only archives (no current)', () => {
    touch('2026-01.jsonl');
    touch('2026-02.jsonl');
    expect(orderedAuditFiles(dir).map((p) => path.basename(p))).toEqual([
      '2026-01.jsonl',
      '2026-02.jsonl',
    ]);
  });

  it('ignores non-jsonl files', () => {
    touch('current.jsonl');
    touch('README.md');
    touch('2026-01.jsonl');
    expect(orderedAuditFiles(dir).map((p) => path.basename(p))).toEqual([
      '2026-01.jsonl',
      'current.jsonl',
    ]);
  });

  it('returns an empty list for an absent directory', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(orderedAuditFiles(dir)).toEqual([]);
    mkdirSync(dir, { recursive: true }); // so afterEach cleanup is a no-op-safe
  });
});
