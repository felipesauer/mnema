import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, makeBench, startRun } from '../../tests/support/chain.js';
import { guard, guardWithFocus } from './guard.js';

describe('guard — the gate asked as a read-only question', () => {
  it('authorizes a legal move, resolving the state from the workflow', () => {
    const verdict = guard({ from: 'READY', action: 'start', who: 'alice', which: 'claude' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.to).toBe('IN_PROGRESS');
  });

  it('refuses an illegal move with the gate’s typed reason', () => {
    const verdict = guard({ from: 'DONE', action: 'start', who: 'alice', which: 'claude' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('ILLEGAL_TRANSITION');
  });

  it('reports a missing required proof field', () => {
    // complete requires a non-empty note.
    const verdict = guard({
      from: 'IN_PROGRESS',
      action: 'complete',
      who: 'alice',
      which: 'claude',
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('MISSING_PROOF');
      expect(verdict.field).toBe('note');
    }
  });

  it('refuses when who and which are the same identity (the invariant)', () => {
    const verdict = guard({ from: 'READY', action: 'start', who: 'sam', which: 'sam' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('WHO_IS_WHICH');
  });

  it('refuses a move with no human who', () => {
    const verdict = guard({ from: 'READY', action: 'start', who: '   ' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('MISSING_WHO');
  });
});

describe('guardWithFocus — the verdict plus the asker’s focus', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('attaches the asker’s open runs to the verdict, writing nothing', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', who: 'alice', goal: 'the thing' });
    const cache = bench.cache();
    try {
      const before = cache.listOpenRuns().length;
      const result = guardWithFocus(cache, {
        from: 'READY',
        action: 'start',
        who: 'alice',
        which: 'claude',
      });
      expect(result.verdict.ok).toBe(true);
      expect(result.focus.actor).toBe('alice');
      expect(result.focus.openRuns.map((r) => r.id)).toEqual(['run-1']);
      // The consultation changed nothing in the read model.
      expect(cache.listOpenRuns().length).toBe(before);
    } finally {
      cache.close();
    }
  });

  it('pairs a refusal with the focus too', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', who: 'alice' });
    const cache = bench.cache();
    try {
      const result = guardWithFocus(cache, {
        from: 'DONE',
        action: 'start',
        who: 'alice',
        which: 'claude',
      });
      expect(result.verdict.ok).toBe(false);
      expect(result.focus.openRuns.map((r) => r.id)).toEqual(['run-1']);
    } finally {
      cache.close();
    }
  });
});
