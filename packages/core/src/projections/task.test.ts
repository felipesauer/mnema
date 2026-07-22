import { type CatalogEvent, taskBirth, taskCreated, taskTransitioned } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { projectTasks } from './task.js';

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number) => ({
  at: at(n),
  who: 'felipe',
  signerFp: 'fp-1',
  subject,
});

describe('projectTasks — the single reader rule', () => {
  it('projects a task from its birth pair with the initial state', () => {
    const events = taskBirth(env('t-1', 0), { title: 'ship it', initial: 'draft' });
    const tasks = projectTasks(events);
    expect(tasks.get('t-1')).toEqual({
      id: 't-1',
      title: 'ship it',
      state: 'draft',
      createdAt: at(0),
      updatedAt: at(0),
    });
  });

  it('takes the state from the LAST transition in order', () => {
    const events: CatalogEvent[] = [
      ...taskBirth(env('t-1', 0), { title: 't', initial: 'draft' }),
      taskTransitioned(env('t-1', 1), { from: 'draft', to: 'ready', action: 'refine' }),
      taskTransitioned(env('t-1', 2), { from: 'ready', to: 'in-progress', action: 'start' }),
    ];
    const task = projectTasks(events).get('t-1');
    expect(task?.state).toBe('in-progress');
    expect(task?.updatedAt).toBe(at(2));
    expect(task?.createdAt).toBe(at(0)); // birth time, not the last transition
  });

  it('does NOT project a bare created with no transition (no state to record)', () => {
    // The birth pair always emits both; a lone created is a truncated tail.
    const events = [taskCreated(env('t-1', 0), { title: 'orphan' })];
    expect(projectTasks(events).has('t-1')).toBe(false);
  });

  it('does NOT project transitions with no created (state without existence)', () => {
    const events = [taskTransitioned(env('t-1', 0), { from: 'a', to: 'b', action: 'go' })];
    expect(projectTasks(events).has('t-1')).toBe(false);
  });

  it('projects independent tasks independently', () => {
    const events: CatalogEvent[] = [
      ...taskBirth(env('t-1', 0), { title: 'first', initial: 'draft' }),
      ...taskBirth(env('t-2', 1), { title: 'second', initial: 'triage' }),
      taskTransitioned(env('t-1', 2), { from: 'draft', to: 'done', action: 'finish' }),
    ];
    const tasks = projectTasks(events);
    expect(tasks.get('t-1')?.state).toBe('done');
    expect(tasks.get('t-2')?.state).toBe('triage');
    expect(tasks.size).toBe(2);
  });

  it('is idempotent: the same ordered events always fold to the same result', () => {
    const events: CatalogEvent[] = [
      ...taskBirth(env('t-1', 0), { title: 't', initial: 'draft' }),
      taskTransitioned(env('t-1', 1), { from: 'draft', to: 'ready', action: 'refine' }),
    ];
    expect(projectTasks(events)).toEqual(projectTasks(events));
  });
});

describe('projectTasks — faithful across workflow evolution', () => {
  it('yields the recorded state, never one re-derived from a workflow', () => {
    // Facts written under an old workflow: born in 'draft', moved to 'shipped'.
    // A later workflow might start tasks in 'triage' and lack draft→shipped.
    // Replaying the OLD facts must still yield 'shipped' — the literal `to`,
    // not a lookup into any current rules.
    const historical: CatalogEvent[] = [
      ...taskBirth(env('t-1', 0), { title: 'legacy', initial: 'draft' }),
      taskTransitioned(env('t-1', 1), { from: 'draft', to: 'shipped', action: 'ship' }),
    ];
    expect(projectTasks(historical).get('t-1')?.state).toBe('shipped');
  });
});
