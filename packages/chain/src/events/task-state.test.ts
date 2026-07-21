/**
 * The task-state contract: a task's state lives ONLY in its transitions, never
 * in its creation event. These tests pin the property the catalog exists to
 * guarantee — not the projection that consumes it (that is the domain's, and
 * lands with SQLite), but the fact-shape it reads from.
 *
 * The single rule a reader follows: a task exists once there is a
 * `task.created`; its current state is the `to` of its last `task.transitioned`
 * (birth included, `from: null`). Because that `to` is a literal recorded when
 * the fact happened, the rule never consults a workflow — so a task written
 * under one workflow reprojects to the SAME state under a later, different one.
 */

import { describe, expect, it } from 'vitest';
import { taskBirth, taskTransitioned } from './build.js';
import type { CatalogEvent } from './catalog.js';

const env = { at: '2026-07-21T00:00:00.000Z', who: 'felipe', subject: 't-1' };

/**
 * The reader's whole rule, in isolation: existence from a `task.created`, state
 * from the last transition's `to`. A stand-in for the projection to come; here
 * it exists to assert the fact-shape supports exactly this and nothing subtler.
 */
function readTaskState(events: readonly CatalogEvent[]): { exists: boolean; state: string | null } {
  let exists = false;
  let state: string | null = null;
  for (const event of events) {
    if (event.subject !== env.subject) continue;
    if (event.kind === 'task.created') exists = true;
    if (event.kind === 'task.transitioned') state = event.payload.to;
  }
  return { exists, state };
}

describe('task-state contract', () => {
  it('a bare task.created gives an existing task with NO state (state lives in transitions)', () => {
    const [created] = taskBirth(env, { title: 't', initial: 'draft' });
    expect(readTaskState([created])).toEqual({ exists: true, state: null });
  });

  it('the birth pair gives an existing task whose state is the birth `to`', () => {
    const pair = taskBirth(env, { title: 't', initial: 'draft' });
    expect(readTaskState(pair)).toEqual({ exists: true, state: 'draft' });
  });

  it('current state is the `to` of the LAST transition, in order', () => {
    const events = [
      ...taskBirth(env, { title: 't', initial: 'draft' }),
      taskTransitioned(env, { from: 'draft', to: 'ready', action: 'refine' }),
      taskTransitioned(env, { from: 'ready', to: 'in-progress', action: 'start' }),
    ];
    expect(readTaskState(events)).toEqual({ exists: true, state: 'in-progress' });
  });

  it('transitions with no create are state without existence (a reader can tell them apart)', () => {
    // Not a legal history, but the rule must not conflate "has state" with
    // "exists" — existence is its own signal (the created event).
    const orphan = taskTransitioned(env, { from: 'a', to: 'b', action: 'go' });
    expect(readTaskState([orphan])).toEqual({ exists: false, state: 'b' });
  });

  it('reprojects to the recorded state even when the workflow has since changed', () => {
    // A task born long ago under a workflow whose initial state was 'draft' and
    // which allowed draft→shipped. Today's workflow (hypothetically) starts
    // tasks in 'triage' and has no such transition. Replaying the OLD facts must
    // still yield 'shipped' — the state that actually happened — because every
    // `to` is a literal in the fact, not a lookup into today's rules. This is
    // the property that keeps state in transitions: reprojection stays faithful
    // across workflow evolution.
    const historicalFacts = [
      ...taskBirth(env, { title: 'legacy task', initial: 'draft' }),
      taskTransitioned(env, { from: 'draft', to: 'shipped', action: 'ship' }),
    ];
    expect(readTaskState(historicalFacts)).toEqual({ exists: true, state: 'shipped' });

    // Had state been DERIVED from a creation event + today's workflow, the same
    // task.created would resolve to today's initial ('triage') — the wrong,
    // rewritten answer. Proving the literal survives is proving that failure is
    // impossible by construction.
    const [created] = historicalFacts;
    expect((created as CatalogEvent).kind).toBe('task.created');
    expect(Object.keys((created as { payload: object }).payload)).not.toContain('state');
  });
});
