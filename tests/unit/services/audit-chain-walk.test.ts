import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';

/**
 * walkChainedEvents indexes events by their position in the CHAINED (v>=2)
 * sequence — the same count audit_state.event_count tracks — so an attestation
 * over [from, to) addresses the right events regardless of interleaved legacy
 * (v1) or malformed lines, and across rotated segments.
 */
describe('walkChainedEvents', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-walk-')), '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(path.dirname(auditDir)), { recursive: true, force: true });
  });

  /** Writes lines (already JSON strings) to a segment file. */
  function segment(name: string, ...lines: string[]): void {
    writeFileSync(path.join(auditDir, name), `${lines.join('\n')}\n`, 'utf-8');
  }
  const ev = (v: number, id: string) =>
    JSON.stringify({
      v,
      at: `t-${id}`,
      kind: 'k',
      actor: 'a',
      data: { id },
      prev_hash: null,
      hash: id,
    });

  it('returns an empty walk for an absent or empty audit dir', () => {
    rmSync(auditDir, { recursive: true, force: true });
    expect(walkChainedEvents(auditDir)).toEqual({ chained: [], malformedLines: 0 });
  });

  it('indexes only chained (v>=2) events, 0-based, in order', () => {
    segment('current.jsonl', ev(2, 'A'), ev(3, 'B'), ev(2, 'C'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B', 'C']);
    expect(walk.malformedLines).toBe(0);
  });

  it('skips legacy (v1) lines without advancing the chained index', () => {
    // A v1 line between chained events must NOT shift the chained index —
    // event_count only counts v>=2, and the .att range must match.
    segment('current.jsonl', ev(2, 'A'), ev(1, 'legacy'), ev(3, 'B'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1]);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B']);
  });

  it('tallies malformed lines and does not index them', () => {
    segment('current.jsonl', ev(2, 'A'), 'this is not json', ev(2, 'B'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.malformedLines).toBe(1);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B']);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1]);
  });

  it('carries the chained index ACROSS rotated segments in chain order', () => {
    // Archived months come first (oldest-first), current.jsonl last; the
    // index is continuous across the boundary.
    segment('2026-05.jsonl', ev(2, 'A'), ev(2, 'B'));
    segment('2026-06.jsonl', ev(3, 'C'));
    segment('current.jsonl', ev(3, 'D'), ev(3, 'E'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('ignores blank lines', () => {
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${ev(2, 'A')}\n\n${ev(2, 'B')}\n`,
      'utf-8',
    );
    expect(walkChainedEvents(auditDir).chained.map((c) => c.event.data.id)).toEqual(['A', 'B']);
  });
});
