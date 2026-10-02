import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthTask, makeBench, moveTask } from '../../tests/support/chain.js';
import { nextActions, nextActionsForTask } from './next-action.js';

describe('nextActions — derived from the workflow table', () => {
  it('offers every move that leaves IN_PROGRESS, each with its proof needs', () => {
    const moves = nextActions('IN_PROGRESS');
    const byAction = new Map(moves.map((m) => [m.action, m]));
    // IN_PROGRESS can block, submit_review, complete, or cancel.
    expect(new Set(byAction.keys())).toEqual(
      new Set(['block', 'submit_review', 'complete', 'cancel']),
    );
    expect(byAction.get('block')).toEqual({ action: 'block', to: 'BLOCKED', requires: ['reason'] });
    expect(byAction.get('submit_review')).toEqual({
      action: 'submit_review',
      to: 'IN_REVIEW',
      requires: [],
    });
    expect(byAction.get('complete')).toEqual({
      action: 'complete',
      to: 'DONE',
      requires: ['note'],
    });
  });

  it('offers only reopen from DONE (a state with a single way out)', () => {
    expect(nextActions('DONE')).toEqual([
      { action: 'reopen', to: 'IN_PROGRESS', requires: ['reason'] },
    ]);
  });

  it('offers nothing from a terminal state (CANCELED has no exit)', () => {
    expect(nextActions('CANCELED')).toEqual([]);
  });

  it('offers nothing for a string that is not a workflow state', () => {
    expect(nextActions('NONSENSE')).toEqual([]);
    expect(nextActions('')).toEqual([]);
  });
});

describe('nextActionsForTask — a task looked up in the cache', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('applies nextActions to the task at its projected state', () => {
    bench = makeBench();
    const id = birthTask(bench, 'task-a', 'Ship it');
    moveTask(bench, id, 'DRAFT', 'READY', 'submit');
    moveTask(bench, id, 'READY', 'IN_PROGRESS', 'start');
    const cache = bench.cache();
    try {
      const moves = nextActionsForTask(cache, id);
      expect(moves).not.toBeNull();
      expect(new Set((moves ?? []).map((m) => m.action))).toEqual(
        new Set(['block', 'submit_review', 'complete', 'cancel']),
      );
    } finally {
      cache.close();
    }
  });

  it('returns null for a task that does not exist', () => {
    bench = makeBench();
    const cache = bench.cache();
    try {
      expect(nextActionsForTask(cache, 'task-missing')).toBeNull();
    } finally {
      cache.close();
    }
  });
});
