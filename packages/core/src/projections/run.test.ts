import { type CatalogEvent, memoryCaptured, runEnded, runStarted } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { projectRuns } from './run.js';

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number, who = 'felipe') => ({
  at: at(n),
  who,
  signerFp: 'fp-1',
  subject,
});
/** A fact PINNED to a run — the envelope slot every event of a session carries. */
const inRun = (subject: string, n: number, run: string) => ({ ...env(subject, n), run });

describe('projectRuns — the reader rule', () => {
  it('projects an open run from run.started with its agent, authorizer, and goal', () => {
    const events = [runStarted(env('r-1', 0), { agent: 'claude', goal: 'ship the thing' })];
    expect(projectRuns(events).get('r-1')).toEqual({
      id: 'r-1',
      agent: 'claude',
      who: 'felipe',
      goal: 'ship the thing',
      open: true,
      startedAt: at(0),
    });
  });

  it('closes a run on run.ended, carrying the outcome and end time', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      runEnded(env('r-1', 1), { outcome: 'done' }),
    ];
    const run = projectRuns(events).get('r-1');
    expect(run?.open).toBe(false);
    expect(run?.outcome).toBe('done');
    expect(run?.endedAt).toBe(at(1));
  });

  it('does NOT project a run.ended with no run.started (no session to close)', () => {
    const events = [runEnded(env('r-1', 0), { outcome: 'huh' })];
    expect(projectRuns(events).has('r-1')).toBe(false);
  });

  it('keeps the authorizer from run.started, not from run.ended', () => {
    // The root of authority is who OPENED the run. Even if the end event were
    // authored under a different `who`, the run's authorizer stays the opener.
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0, 'felipe'), { agent: 'claude' }),
      runEnded(env('r-1', 1, 'someone-else'), {}),
    ];
    expect(projectRuns(events).get('r-1')?.who).toBe('felipe');
  });

  it('omits goal and outcome when the events did not carry them', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      runEnded(env('r-1', 1), {}),
    ];
    const run = projectRuns(events).get('r-1');
    expect(run).not.toHaveProperty('goal');
    expect(run).not.toHaveProperty('outcome');
  });

  it('projects several runs, open and closed', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      runStarted(env('r-2', 1), { agent: 'cursor' }),
      runEnded(env('r-1', 2), { outcome: 'shipped' }),
    ];
    const runs = projectRuns(events);
    expect(runs.get('r-1')?.open).toBe(false);
    expect(runs.get('r-2')?.open).toBe(true);
    expect(runs.size).toBe(2);
  });

  it('is idempotent: the same ordered events always fold to the same result', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude', goal: 'g' }),
      runEnded(env('r-1', 1), { outcome: 'o' }),
    ];
    expect(projectRuns(events)).toEqual(projectRuns(events));
  });
});

describe('projectRuns — when the run last did something', () => {
  it('folds the `at` of the most recent fact PINNED to the run', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      memoryCaptured(inRun('m-1', 1, 'r-1'), { content: 'first' }),
      memoryCaptured(inRun('m-2', 3, 'r-1'), { content: 'second' }),
    ];
    expect(projectRuns(events).get('r-1')?.lastFactAt).toBe(at(3));
  });

  it('omits it for a run nothing was pinned to', () => {
    // A real state, not a gap: a session opens its run at the first write, so a run
    // with no fact is one whose first write did not land. Reporting the start instant
    // here would let a reader measure idleness from a fact that does not exist.
    const events = [runStarted(env('r-1', 0), { agent: 'claude' })];
    expect(projectRuns(events).get('r-1')).not.toHaveProperty('lastFactAt');
  });

  it('does not count the run’s OWN birth or end as a fact recorded in it', () => {
    // Neither event carries a `run` — their subject IS the run — so a run that only
    // started and ended has recorded nothing, and the projection must say so rather
    // than reporting its own bookkeeping as work.
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      runEnded(env('r-1', 5), {}),
    ];
    expect(projectRuns(events).get('r-1')).not.toHaveProperty('lastFactAt');
  });

  it('takes the greatest `at`, not the last event seen', () => {
    // The stream is interleaved ACROSS tails, and a run's facts can come from more
    // than one of them. Last-seen would let a tail read later hand back an earlier
    // instant — which reads as a run that went idle and then un-idled.
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      memoryCaptured(inRun('m-late', 4, 'r-1'), { content: 'later' }),
      memoryCaptured(inRun('m-early', 2, 'r-1'), { content: 'earlier' }),
    ];
    expect(projectRuns(events).get('r-1')?.lastFactAt).toBe(at(4));
  });

  it('keeps each run’s own last fact apart', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      runStarted(env('r-2', 1), { agent: 'cursor' }),
      memoryCaptured(inRun('m-1', 2, 'r-1'), { content: 'in one' }),
      memoryCaptured(inRun('m-2', 5, 'r-2'), { content: 'in the other' }),
    ];
    const runs = projectRuns(events);
    expect(runs.get('r-1')?.lastFactAt).toBe(at(2));
    expect(runs.get('r-2')?.lastFactAt).toBe(at(5));
  });

  it('does not invent a run from a fact that cites one this stream never started', () => {
    // Legitimate by design: a fact routed to project B cites B's run, and B's tree is
    // where that run was born. This tree reports the runs IT holds, so a citation
    // alone must not produce a run with no birth, agent or authorizer.
    const events = [memoryCaptured(inRun('m-1', 1, 'r-elsewhere'), { content: 'over there' })];
    expect(projectRuns(events).has('r-elsewhere')).toBe(false);
  });
});
