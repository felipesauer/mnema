import { describe, expect, it } from 'vitest';
import {
  BIRTH_ACTION,
  runEnded,
  runStarted,
  taskBirth,
  taskCreated,
  taskTransitioned,
} from './build.js';
import { canonicalStringify } from './canonical.js';
import { toCanonical } from './parse.js';

const env = { at: '2026-07-21T00:00:00.000Z', who: 'felipe', subject: 's-1' };

describe('event builders', () => {
  it('stamp the latest version and kind', () => {
    expect(runStarted(env, { agent: 'a' })).toMatchObject({ v: 1, kind: 'run.started' });
    expect(runEnded(env)).toMatchObject({ v: 1, kind: 'run.ended' });
    expect(taskCreated(env, { title: 't' })).toMatchObject({ v: 1, kind: 'task.created' });
    expect(taskTransitioned(env, { from: 'a', to: 'b', action: 'go' })).toMatchObject({
      v: 1,
      kind: 'task.transitioned',
    });
  });

  it('OMIT absent optional fields rather than setting them to undefined', () => {
    // A hand-written literal with `which: undefined` would break canonicalization;
    // the builder must leave the key out entirely so the event is signable.
    const event = runStarted(env, { agent: 'a' });
    expect(Object.keys(event)).not.toContain('which');
    expect(Object.keys(event)).not.toContain('run');
    expect(Object.keys(event.payload)).not.toContain('goal');
    // And it canonicalizes without throwing.
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });

  it('INCLUDE optional fields when provided', () => {
    const event = runStarted(
      { ...env, which: 'claude', run: 'r-1' },
      { agent: 'claude', goal: 'ship' },
    );
    expect(event.which).toBe('claude');
    expect(event.run).toBe('r-1');
    if (event.kind === 'run.started') expect(event.payload.goal).toBe('ship');
  });

  it('produce canonicalization-safe events even when built with explicit undefined optionals', () => {
    // Passing `goal: undefined` explicitly must still yield an omitted key.
    const event = runStarted({ ...env, which: undefined }, { agent: 'a', goal: undefined });
    expect(Object.keys(event)).not.toContain('which');
    expect(Object.keys(event.payload)).not.toContain('goal');
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });

  it('accept a null `from` (the birth transition) and keep it canonicalizable', () => {
    const event = taskTransitioned(env, { from: null, to: 'draft', action: BIRTH_ACTION });
    if (event.kind === 'task.transitioned') {
      expect(event.payload.from).toBeNull();
      expect(event.payload.to).toBe('draft');
    }
    // `null` is a first-class canonical value, so a birth transition signs cleanly.
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });
});

describe('taskBirth', () => {
  it('emits the pair in order: created then the birth transition', () => {
    const [created, transitioned] = taskBirth(env, { title: 'ship it', initial: 'draft' });
    expect(created).toMatchObject({ kind: 'task.created', payload: { title: 'ship it' } });
    expect(transitioned).toMatchObject({
      kind: 'task.transitioned',
      payload: { from: null, to: 'draft', action: BIRTH_ACTION },
    });
  });

  it('stamps both events with the same envelope (one atomic fact)', () => {
    const [created, transitioned] = taskBirth(
      { ...env, which: 'claude', run: 'r-1' },
      { title: 't', initial: 'draft' },
    );
    // Same subject, actor, run, and timestamp: the create and its state are the
    // same birth, so a reader groups them by subject with no ambiguity.
    expect(created.subject).toBe(transitioned.subject);
    expect(created.at).toBe(transitioned.at);
    expect(created.who).toBe(transitioned.who);
    expect(created.which).toBe(transitioned.which);
    expect(created.run).toBe(transitioned.run);
  });

  it('carries the initial state as a literal, not derived from any workflow', () => {
    // The caller decides `initial`; the chain records whatever literal it is
    // told, so a workflow that later starts tasks elsewhere never rewrites this.
    const [, transitioned] = taskBirth(env, { title: 't', initial: 'triage' });
    if (transitioned.kind === 'task.transitioned') {
      expect(transitioned.payload.to).toBe('triage');
      expect(transitioned.payload.from).toBeNull();
    }
  });
});
