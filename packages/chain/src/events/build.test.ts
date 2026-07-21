import { describe, expect, it } from 'vitest';
import { runEnded, runStarted, taskCreated, taskTransitioned } from './build.js';
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
});
