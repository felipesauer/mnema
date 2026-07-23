import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, endRun, makeBench, startRun } from '../../tests/support/chain.js';
import { focus, resume } from './focus.js';

describe('focus — what an actor is touching now', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('reports the actor’s open runs, most recently started first', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', goal: 'first' });
    startRun(bench, 'run-2', { agent: 'claude', goal: 'second' });
    const cache = bench.cache();
    try {
      const f = focus(cache, { actor: bench.who });
      expect(f.actor).toBe(bench.who);
      expect(f.openRuns.map((r) => r.id)).toEqual(['run-2', 'run-1']);
      expect(f.openRuns[0]?.goal).toBe('second');
    } finally {
      cache.close();
    }
  });

  it('excludes runs the actor has already ended', () => {
    bench = makeBench();
    startRun(bench, 'run-open', { agent: 'claude' });
    startRun(bench, 'run-done', { agent: 'claude' });
    endRun(bench, 'run-done');
    const cache = bench.cache();
    try {
      const f = focus(cache, { actor: bench.who });
      expect(f.openRuns.map((r) => r.id)).toEqual(['run-open']);
    } finally {
      cache.close();
    }
  });

  it('never leaks another actor’s runs', () => {
    bench = makeBench();
    startRun(bench, 'run-mine', { agent: 'claude', who: 'alice' });
    startRun(bench, 'run-theirs', { agent: 'claude', who: 'bob' });
    const cache = bench.cache();
    try {
      expect(focus(cache, { actor: 'alice' }).openRuns.map((r) => r.id)).toEqual(['run-mine']);
      expect(focus(cache, { actor: 'bob' }).openRuns.map((r) => r.id)).toEqual(['run-theirs']);
    } finally {
      cache.close();
    }
  });

  it('is empty for an actor with nothing open, and for a blank actor', () => {
    bench = makeBench();
    startRun(bench, 'run-x', { agent: 'claude', who: 'alice' });
    const cache = bench.cache();
    try {
      expect(focus(cache, { actor: 'nobody' }).openRuns).toEqual([]);
      expect(focus(cache, { actor: '   ' }).openRuns).toEqual([]);
      expect(focus(cache, { actor: '   ' }).actor).toBe('');
    } finally {
      cache.close();
    }
  });

  it('matches an actor spelled in a different Unicode composition', () => {
    // "José" written decomposed (NFD) must resolve to the same actor the chain
    // sealed in NFC — focus canonicalizes with the core's identity rule.
    bench = makeBench();
    const nfc = 'José'; // José
    const nfd = 'José'; // Jose + combining acute
    startRun(bench, 'run-jose', { agent: 'claude', who: nfc });
    const cache = bench.cache();
    try {
      expect(focus(cache, { actor: nfd }).openRuns.map((r) => r.id)).toEqual(['run-jose']);
    } finally {
      cache.close();
    }
  });

  it('does not match a who sealed outside the core’s identity discipline (padded)', () => {
    // The chain NFC-normalizes but does not TRIM, so a `who` sealed with
    // surrounding spaces is stored verbatim. No gate or operation produces such a
    // `who` (they derive it from the writer anchor), so focus is right not to
    // match it — this pins that contract: the actor is canonicalized (trim+NFC),
    // and only a `who` in that same canonical form is found.
    bench = makeBench();
    startRun(bench, 'run-padded', { agent: 'claude', who: '  alice  ' });
    const cache = bench.cache();
    try {
      // The stored who really is the padded form (the chain did not trim it).
      expect(cache.getRun('run-padded')?.who).toBe('  alice  ');
      // Neither the trimmed spelling nor the padded one matches: the trimmed
      // actor never equals the untrimmed stored who.
      expect(focus(cache, { actor: 'alice' }).openRuns).toEqual([]);
      expect(focus(cache, { actor: '  alice  ' }).openRuns).toEqual([]);
    } finally {
      cache.close();
    }
  });
});

describe('resume — where an actor left off', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('returns the latest run even when it has already ended, plus the open focus', () => {
    bench = makeBench();
    startRun(bench, 'run-old', { agent: 'claude', goal: 'yesterday' });
    endRun(bench, 'run-old', 'shipped');
    startRun(bench, 'run-new', { agent: 'claude', goal: 'today' });
    endRun(bench, 'run-new', 'also shipped');
    const cache = bench.cache();
    try {
      const r = resume(cache, { actor: bench.who });
      // The most recently STARTED run is the anchor, even though it ended.
      expect(r.lastRun?.id).toBe('run-new');
      expect(r.lastRun?.goal).toBe('today');
      expect(r.lastRun?.outcome).toBe('also shipped');
      // Nothing is open, so the composed focus is empty.
      expect(r.focus.openRuns).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('composes the open focus when the latest run is still open', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', goal: 'earlier' });
    startRun(bench, 'run-2', { agent: 'claude', goal: 'current' });
    const cache = bench.cache();
    try {
      const r = resume(cache, { actor: bench.who });
      expect(r.lastRun?.id).toBe('run-2');
      expect(r.focus.openRuns.map((x) => x.id)).toEqual(['run-2', 'run-1']);
    } finally {
      cache.close();
    }
  });

  it('has a null lastRun and empty focus for an actor with no runs', () => {
    bench = makeBench();
    startRun(bench, 'run-someone', { agent: 'claude', who: 'someone-else' });
    const cache = bench.cache();
    try {
      const r = resume(cache, { actor: 'me' });
      expect(r.lastRun).toBeNull();
      expect(r.focus.openRuns).toEqual([]);
    } finally {
      cache.close();
    }
  });
});
