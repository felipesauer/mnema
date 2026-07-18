import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { EVENT_FORMAT_VERSION } from '@/storage/audit/audit-hash.js';

/**
 * walkChainedEvents indexes events by their position in the chained sequence —
 * the same count audit_state.event_count tracks — so an attestation over
 * [from, to) addresses the right events regardless of interleaved non-keyed or
 * malformed lines, and across rotated segments.
 */
const V = EVENT_FORMAT_VERSION;
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
    expect(walkChainedEvents(auditDir)).toEqual({
      chained: [],
      malformedLines: 0,
      unhashedLines: 0,
    });
  });

  it('tallies a v>=2 line with no hash but still indexes it (keeps event_count alignment)', () => {
    // A chained line without a `hash` must NOT shift the chained index (it is
    // still a keyed event that event_count counts), but is tallied so the
    // attestation planner can refuse a batch containing it.
    const noHash = JSON.stringify({ v: V, at: 't', kind: 'k', actor: 'a', data: { id: 'X' } });
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${ev(V, 'A')}\n${noHash}\n${ev(V, 'B')}\n`,
      'utf-8',
    );
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(walk.unhashedLines).toBe(1);
  });

  it('indexes only chained events, 0-based, in order', () => {
    segment('current.jsonl', ev(V, 'A'), ev(V, 'B'), ev(V, 'C'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B', 'C']);
    expect(walk.malformedLines).toBe(0);
  });

  it('skips a non-keyed line without advancing the chained index', () => {
    // A line whose version is not the event format tag is not a chained event
    // — event_count only counts chained lines, and the .att range must match.
    const stray = JSON.stringify({ v: 0, at: 't', kind: 'k', actor: 'a', data: { id: 'x' } });
    segment('current.jsonl', ev(V, 'A'), stray, ev(V, 'B'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1]);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B']);
  });

  it('tallies malformed lines and does not index them', () => {
    segment('current.jsonl', ev(V, 'A'), 'this is not json', ev(V, 'B'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.malformedLines).toBe(1);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B']);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1]);
  });

  it('carries the chained index ACROSS rotated segments in chain order', () => {
    // Archived months come first (oldest-first), current.jsonl last; the
    // index is continuous across the boundary.
    segment('2026-05.jsonl', ev(V, 'A'), ev(V, 'B'));
    segment('2026-06.jsonl', ev(V, 'C'));
    segment('current.jsonl', ev(V, 'D'), ev(V, 'E'));
    const walk = walkChainedEvents(auditDir);
    expect(walk.chained.map((c) => c.event.data.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(walk.chained.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('ignores blank lines', () => {
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${ev(V, 'A')}\n\n${ev(V, 'B')}\n`,
      'utf-8',
    );
    expect(walkChainedEvents(auditDir).chained.map((c) => c.event.data.id)).toEqual(['A', 'B']);
  });
});
