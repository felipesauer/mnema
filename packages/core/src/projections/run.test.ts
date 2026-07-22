import { type CatalogEvent, runEnded, runStarted } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { projectRuns } from './run.js';

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number, who = 'felipe') => ({
  at: at(n),
  who,
  signerFp: 'fp-1',
  subject,
});

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
