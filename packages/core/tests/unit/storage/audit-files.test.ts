import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditFilesSignature,
  auditTailDirs,
  orderedAuditFiles,
} from '@/storage/audit/audit-files.js';

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

describe('auditTailDirs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-tails-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats a root dir holding .jsonl directly as one degenerate tail', () => {
    writeFileSync(path.join(dir, 'current.jsonl'), '', 'utf-8');
    expect(auditTailDirs(dir)).toEqual([dir]);
  });

  it('lists each machine tail, sorted by name', () => {
    mkdirSync(path.join(dir, 'm-000000000002'));
    mkdirSync(path.join(dir, 'm-000000000001'));
    expect(auditTailDirs(dir)).toEqual([
      path.join(dir, 'm-000000000001'),
      path.join(dir, 'm-000000000002'),
    ]);
  });

  it('ignores non-tail subdirectories (e.g. attest/)', () => {
    mkdirSync(path.join(dir, 'm-00000000abcd'));
    mkdirSync(path.join(dir, 'attest'));
    expect(auditTailDirs(dir)).toEqual([path.join(dir, 'm-00000000abcd')]);
  });
});

describe('auditFilesSignature', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-sig-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('flips when a line is appended inside a machine tail (cache invalidation)', () => {
    // The regression this guards: a signature that only listed the root dir
    // would never change when an event landed in `m-<id>/`, so a cache keyed
    // on it would serve a stale integrity verdict.
    const tail = path.join(dir, 'm-00000000feed');
    mkdirSync(tail);
    writeFileSync(path.join(tail, 'current.jsonl'), 'a\n', 'utf-8');
    const before = auditFilesSignature(dir);
    writeFileSync(path.join(tail, 'current.jsonl'), 'a\nb\n', 'utf-8');
    expect(auditFilesSignature(dir)).not.toBe(before);
  });
});
