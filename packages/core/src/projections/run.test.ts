import {
  type CatalogEvent,
  memoryCaptured,
  observationRecorded,
  runEnded,
  runStarted,
  taskCreated,
} from '@mnema/chain';
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
      // Present and EMPTY on a run that has written nothing — the whole point of the
      // field being non-optional. This is an exact-shape assertion, so it is also what
      // fails if the fold ever stops attaching it.
      wrote: [],
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

describe('projectRuns — WHAT was written in the run', () => {
  it('tallies the facts pinned to it, per kind, and says how many of each', () => {
    // The complaint this answers, in one line: the reads reported the CONTAINER. A run
    // that recorded three different sorts of fact and one that recorded a single note
    // reported identically, because `lastFactAt` says WHEN and can never say WHAT.
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      memoryCaptured(inRun('m-1', 1, 'r-1'), { content: 'first' }),
      taskCreated(inRun('t-1', 2, 'r-1'), { title: 'a job' }),
      memoryCaptured(inRun('m-2', 3, 'r-1'), { content: 'second' }),
      observationRecorded(inRun('o-1', 4, 'r-1'), { about: 't-1', topic: 'why', text: 'a note' }),
      memoryCaptured(inRun('m-3', 5, 'r-1'), { content: 'third' }),
    ];
    // The VALUE, whole: commonest kind first, and the two that tie broken by the kind's
    // own spelling. Asserting the array entire is what makes the order part of the
    // claim rather than something a reader may or may not get.
    expect(projectRuns(events).get('r-1')?.wrote).toEqual([
      { kind: 'memory.captured', count: 3 },
      { kind: 'observation.recorded', count: 1 },
      { kind: 'task.created', count: 1 },
    ]);
  });

  it('answers EMPTY for a run that wrote nothing — never absent', () => {
    // Distinguishable from "I do not know", which is what an absent field claims. The
    // fold saw the whole stream, so it knows the answer is none, and a zero-length list
    // is how it says so. `lastFactAt` beside it IS absent in this same case, and the
    // pair of assertions is the difference stated rather than described.
    const events = [runStarted(env('r-1', 0), { agent: 'claude' })];
    const run = projectRuns(events).get('r-1');
    expect(run).toHaveProperty('wrote');
    expect(run?.wrote).toEqual([]);
    expect(run).not.toHaveProperty('lastFactAt');
  });

  it('does not count the run’s OWN birth or end as something written in it', () => {
    // Neither carries a `run` — their subject IS the run — so a session's own
    // bookkeeping is not work it did. Same rule `lastFactAt` follows, off the same slot.
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude', goal: 'g' }),
      runEnded(env('r-1', 5), { outcome: 'o' }),
    ];
    expect(projectRuns(events).get('r-1')?.wrote).toEqual([]);
  });

  it('keeps each run’s own tally apart', () => {
    const events: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      runStarted(env('r-2', 1), { agent: 'cursor' }),
      memoryCaptured(inRun('m-1', 2, 'r-1'), { content: 'in one' }),
      taskCreated(inRun('t-1', 3, 'r-2'), { title: 'in the other' }),
      taskCreated(inRun('t-2', 4, 'r-2'), { title: 'in the other again' }),
    ];
    const runs = projectRuns(events);
    expect(runs.get('r-1')?.wrote).toEqual([{ kind: 'memory.captured', count: 1 }]);
    expect(runs.get('r-2')?.wrote).toEqual([{ kind: 'task.created', count: 2 }]);
  });

  it('orders the tally the same way whatever order the kinds arrive in', () => {
    // The order is stored and compared (`run-store.ts` round-trips the array, and the
    // incremental fold is asserted byte-identical to a full replay), so it has to be a
    // function of the counts and the names alone. Two streams with the SAME tally and
    // the opposite arrival order must fold to the same array.
    const forward: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      taskCreated(inRun('t-1', 1, 'r-1'), { title: 'one' }),
      memoryCaptured(inRun('m-1', 2, 'r-1'), { content: 'two' }),
    ];
    const backward: CatalogEvent[] = [
      runStarted(env('r-1', 0), { agent: 'claude' }),
      memoryCaptured(inRun('m-1', 1, 'r-1'), { content: 'two' }),
      taskCreated(inRun('t-1', 2, 'r-1'), { title: 'one' }),
    ];
    // NOT vacuous: both really did record one of each, so the tie-break is the only
    // thing deciding the order here.
    expect(projectRuns(forward).get('r-1')?.wrote).toEqual([
      { kind: 'memory.captured', count: 1 },
      { kind: 'task.created', count: 1 },
    ]);
    expect(projectRuns(backward).get('r-1')?.wrote).toEqual(projectRuns(forward).get('r-1')?.wrote);
  });

  it('tallies a fact pinned to a run this stream never opened — and drops the run', () => {
    // The rule the module already states, met by the new field: an accumulator is
    // created for any `run` seen on an envelope, and one with no birth is not projected.
    // The tally must not resurrect it.
    const events: CatalogEvent[] = [
      memoryCaptured(inRun('m-1', 1, 'elsewhere'), { content: 'another tree opened it' }),
    ];
    expect(projectRuns(events).has('elsewhere')).toBe(false);
  });
});
