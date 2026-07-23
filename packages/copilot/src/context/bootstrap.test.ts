import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthTask, makeBench, moveTask, startRun } from '../../tests/support/chain.js';
import { bootstrap } from './bootstrap.js';

describe('bootstrap — the opening context, focused on the actor', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('composes the actor’s resume and the actionable work with its moves', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', goal: 'in flight' });
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    const cache = bench.cache();
    try {
      const b = bootstrap(cache, { actor: bench.who });
      // Resume: the actor's open run is the anchor.
      expect(b.resume.lastRun?.id).toBe('run-1');
      expect(b.resume.focus.openRuns.map((r) => r.id)).toEqual(['run-1']);
      // Work: the live task, carrying the moves the workflow allows from it.
      expect(b.work.map((w) => w.id)).toEqual(['task-1']);
      expect(new Set(b.work[0]?.actions.map((a) => a.action))).toEqual(
        new Set(['block', 'submit_review', 'complete', 'cancel']),
      );
    } finally {
      cache.close();
    }
  });

  it('omits a terminal task (CANCELED has no next move) from the work list', () => {
    bench = makeBench();
    const live = birthTask(bench, 'task-live', 'Still going');
    moveTask(bench, live, 'DRAFT', 'READY', 'submit');
    const dead = birthTask(bench, 'task-dead', 'Abandoned');
    moveTask(bench, dead, 'DRAFT', 'CANCELED', 'cancel', { reason: 'dropped' });
    const cache = bench.cache();
    try {
      const b = bootstrap(cache, { actor: bench.who });
      expect(b.work.map((w) => w.id)).toEqual(['task-live']);
    } finally {
      cache.close();
    }
  });

  it('keeps a DONE task in the work list, because it can still be reopened', () => {
    bench = makeBench();
    const t = birthTask(bench, 'task-done', 'Shipped');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, t, 'IN_PROGRESS', 'DONE', 'complete', { note: 'done' });
    const cache = bench.cache();
    try {
      const b = bootstrap(cache, { actor: bench.who });
      const done = b.work.find((w) => w.id === 'task-done');
      expect(done?.actions.map((a) => a.action)).toEqual(['reopen']);
    } finally {
      cache.close();
    }
  });

  it('orders the work most recently touched first', () => {
    bench = makeBench();
    const a = birthTask(bench, 'task-a', 'A');
    const b = birthTask(bench, 'task-b', 'B');
    // Touch A last, so it is the freshest.
    moveTask(bench, b, 'DRAFT', 'READY', 'submit');
    moveTask(bench, a, 'DRAFT', 'READY', 'submit');
    const cache = bench.cache();
    try {
      const boot = bootstrap(cache, { actor: bench.who });
      expect(boot.work.map((w) => w.id)).toEqual(['task-a', 'task-b']);
    } finally {
      cache.close();
    }
  });

  it('stays lean on the actor’s side: another actor’s run never enters the resume', () => {
    bench = makeBench();
    startRun(bench, 'run-mine', { agent: 'claude', who: 'alice' });
    startRun(bench, 'run-theirs', { agent: 'claude', who: 'bob' });
    const cache = bench.cache();
    try {
      const b = bootstrap(cache, { actor: 'alice' });
      expect(b.resume.focus.openRuns.map((r) => r.id)).toEqual(['run-mine']);
      expect(b.resume.lastRun?.id).toBe('run-mine');
    } finally {
      cache.close();
    }
  });

  it('gives an actor with no runs an empty resume but the shared work list', () => {
    bench = makeBench();
    startRun(bench, 'run-other', { agent: 'claude', who: 'someone' });
    const t = birthTask(bench, 'task-1', 'Work exists');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    const cache = bench.cache();
    try {
      const b = bootstrap(cache, { actor: 'newcomer' });
      expect(b.resume.lastRun).toBeNull();
      expect(b.resume.focus.openRuns).toEqual([]);
      // The work list is workspace-wide, so it is still there.
      expect(b.work.map((w) => w.id)).toEqual(['task-1']);
    } finally {
      cache.close();
    }
  });
});
