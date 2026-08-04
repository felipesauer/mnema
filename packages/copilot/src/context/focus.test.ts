import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asking,
  type Bench,
  capture,
  endRun,
  makeBench,
  startRun,
} from '../../tests/support/chain.js';
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
      const f = focus([cache], asking(bench.who));
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
      const f = focus([cache], asking(bench.who));
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
      expect(focus([cache], asking('alice')).openRuns.map((r) => r.id)).toEqual(['run-mine']);
      expect(focus([cache], asking('bob')).openRuns.map((r) => r.id)).toEqual(['run-theirs']);
    } finally {
      cache.close();
    }
  });

  it('is empty for an actor with nothing open, and for a blank actor', () => {
    bench = makeBench();
    startRun(bench, 'run-x', { agent: 'claude', who: 'alice' });
    const cache = bench.cache();
    try {
      expect(focus([cache], asking('nobody')).openRuns).toEqual([]);
      expect(focus([cache], asking('   ')).openRuns).toEqual([]);
      expect(focus([cache], asking('   ')).actor).toBe('');
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
      expect(focus([cache], asking(nfd)).openRuns.map((r) => r.id)).toEqual(['run-jose']);
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
      expect(focus([cache], asking('alice')).openRuns).toEqual([]);
      expect(focus([cache], asking('  alice  ')).openRuns).toEqual([]);
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
      const r = resume([cache], asking(bench.who));
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
      const r = resume([cache], asking(bench.who));
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
      const r = resume([cache], asking('me'));
      expect(r.lastRun).toBeNull();
      expect(r.focus.openRuns).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('prefers a run THIS asker opened over a newer one it did not', () => {
    // The measured contra-example. Two sessions alive at once share the machine's
    // anchor, so "the actor's latest run" was whichever started last — and agent A
    // asking "where did I leave off" was handed agent B's open run.
    bench = makeBench();
    startRun(bench, 'run-mine', { agent: 'agent-a' });
    startRun(bench, 'run-theirs', { agent: 'agent-b' });
    const cache = bench.cache();
    try {
      const r = resume([cache], asking(bench.who, { sessionRuns: ['run-mine'] }));
      expect(r.lastRun?.id).toBe('run-mine');
      expect(r.lastRun?.thisSession).toBe(true);
      // And the other one is still reported — as not this asker's.
      expect(r.focus.openRuns.map((x) => [x.id, x.thisSession])).toEqual([
        ['run-theirs', false],
        ['run-mine', true],
      ]);
    } finally {
      cache.close();
    }
  });

  it('prefers the asker’s NEWEST run when it opened more than one', () => {
    bench = makeBench();
    startRun(bench, 'run-first', { agent: 'claude' });
    startRun(bench, 'run-second', { agent: 'claude' });
    const cache = bench.cache();
    try {
      const r = resume([cache], asking(bench.who, { sessionRuns: ['run-first', 'run-second'] }));
      expect(r.lastRun?.id).toBe('run-second');
    } finally {
      cache.close();
    }
  });

  it('falls back to the actor’s latest run when this record holds none of the asker’s', () => {
    // A session whose runs are all in OTHER trees finds none here — and that is right:
    // a session that has written nothing in this record has no run of its own to point
    // at, so the read still answers with the run the work happened in. This is the
    // property the deferred run bought, and the preference must not take it back.
    bench = makeBench();
    startRun(bench, 'run-where-work-happened', { agent: 'claude', goal: 'the real work' });
    const cache = bench.cache();
    try {
      const r = resume([cache], asking(bench.who, { sessionRuns: ['run-in-another-project'] }));
      expect(r.lastRun?.id).toBe('run-where-work-happened');
      expect(r.lastRun?.thisSession).toBe(false);
    } finally {
      cache.close();
    }
  });
});

describe('what a reported run says about its age and its idleness', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('measures age from the start and idleness from the last fact pinned to the run', () => {
    // The bench clock ticks a second per event from 2026-01-01T00:00:00Z, and the
    // asker asks an hour in — so both numbers are exact rather than sniffed at.
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude' }); // at :00
    capture(bench, 'mem-1', 'something', 'run-1'); // at :01
    capture(bench, 'mem-2', 'something later', 'run-1'); // at :02
    const cache = bench.cache();
    try {
      const [run] = focus([cache], asking(bench.who)).openRuns;
      expect(run?.ageSeconds).toBe(3600);
      expect(run?.idleSeconds).toBe(3598);
    } finally {
      cache.close();
    }
  });

  it('reports NO idleness for a run nothing was recorded in', () => {
    // Measured: a kill 5 ms after the append leaves exactly this. The age is then the
    // only measure there is, and saying so beats reporting the age under idleness's
    // name — which would claim a fact was recorded when none was.
    bench = makeBench();
    startRun(bench, 'run-empty', { agent: 'claude' });
    const cache = bench.cache();
    try {
      const [run] = focus([cache], asking(bench.who)).openRuns;
      expect(run?.ageSeconds).toBe(3600);
      expect(run).not.toHaveProperty('idleSeconds');
    } finally {
      cache.close();
    }
  });

  it('does not count the run’s own facts of OTHER runs as its own', () => {
    bench = makeBench();
    startRun(bench, 'run-a', { agent: 'claude' }); // at :00
    startRun(bench, 'run-b', { agent: 'claude' }); // at :01
    capture(bench, 'mem-b', 'only in b', 'run-b'); // at :02
    const cache = bench.cache();
    try {
      const runs = focus([cache], asking(bench.who)).openRuns;
      const a = runs.find((r) => r.id === 'run-a');
      const b = runs.find((r) => r.id === 'run-b');
      expect(a).not.toHaveProperty('idleSeconds');
      expect(b?.idleSeconds).toBe(3598);
    } finally {
      cache.close();
    }
  });

  it('reports a NEGATIVE age rather than clamping when the writer’s clock is ahead', () => {
    // Two clocks, and the answer says which way they disagree. A zero here would
    // present a disagreement as a fresh run, and the reader would have no way to see
    // that a run in the list was written by a machine an hour ahead.
    bench = makeBench();
    startRun(bench, 'run-future', { agent: 'claude' });
    const cache = bench.cache();
    try {
      const [run] = focus(
        [cache],
        asking(bench.who, { asOf: '2025-12-31T23:00:00.000Z' }),
      ).openRuns;
      expect(run?.ageSeconds).toBe(-3600);
    } finally {
      cache.close();
    }
  });

  it('omits age and idleness when the asker’s instant cannot be read', () => {
    // A number derived from an unparseable input would be `NaN`, and `NaN` serialized
    // into a reply is a field that reads as present and answers nothing.
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude' });
    capture(bench, 'mem-1', 'something', 'run-1');
    const cache = bench.cache();
    try {
      const [run] = focus([cache], asking(bench.who, { asOf: 'not an instant' })).openRuns;
      expect(run).not.toHaveProperty('ageSeconds');
      expect(run).not.toHaveProperty('idleSeconds');
      // Whose it is does not depend on a clock, so that half still answers.
      expect(run?.thisSession).toBe(false);
    } finally {
      cache.close();
    }
  });

  it('attaches NEITHER to an ended run, which already reports its own end', () => {
    // An age on an ended run reads as time still passing in it, and idleness is a
    // question about something still in flight.
    bench = makeBench();
    startRun(bench, 'run-done', { agent: 'claude' });
    capture(bench, 'mem-1', 'something', 'run-done');
    endRun(bench, 'run-done', 'shipped');
    const cache = bench.cache();
    try {
      const r = resume([cache], asking(bench.who));
      expect(r.lastRun?.open).toBe(false);
      expect(r.lastRun).not.toHaveProperty('ageSeconds');
      expect(r.lastRun).not.toHaveProperty('idleSeconds');
      // Whose it is is still answered: that is not a property of being open.
      expect(r.lastRun?.thisSession).toBe(false);
    } finally {
      cache.close();
    }
  });

  it('carries the projection through untouched — the added fields only add', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', goal: 'the goal' });
    const cache = bench.cache();
    try {
      const [reported] = focus([cache], asking(bench.who)).openRuns;
      const projected = cache.getRun('run-1');
      expect(reported).toMatchObject(projected as Record<string, unknown>);
    } finally {
      cache.close();
    }
  });
});
