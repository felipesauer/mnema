import { describe, expect, it } from 'vitest';
import {
  BIRTH_ACTION,
  decisionBirth,
  decisionRecorded,
  decisionTransitioned,
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

  it('OMITS `fields` when not provided (byte-identical to no proof)', () => {
    const without = taskTransitioned(env, { from: 'a', to: 'b', action: 'go' });
    const withEmpty = taskTransitioned(env, { from: 'a', to: 'b', action: 'go', fields: {} });
    expect(Object.keys(without.payload)).not.toContain('fields');
    // An empty fields object is dropped, so it cannot become a second spelling.
    expect(Object.keys(withEmpty.payload)).not.toContain('fields');
    expect(canonicalStringify(toCanonical(withEmpty))).toBe(
      canonicalStringify(toCanonical(without)),
    );
  });

  it('INCLUDES only the defined proof fields, dropping explicit-undefined ones', () => {
    const event = taskTransitioned(env, {
      from: 'in-progress',
      to: 'done',
      action: 'complete',
      fields: { note: 'shipped', pr_url: undefined, reason: undefined },
    });
    if (event.kind === 'task.transitioned') {
      expect(event.payload.fields).toEqual({ note: 'shipped' });
      expect(Object.keys(event.payload.fields ?? {})).not.toContain('pr_url');
    }
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });

  it('OMITS an empty-string optional field so the line stays re-readable', () => {
    // An empty optional (pr_url: '') would serialize fine but the parser rejects
    // an empty string on read — a line the chain could write but never read
    // back. The builder drops it, symmetric with the parser.
    const event = taskTransitioned(env, {
      from: 'in-progress',
      to: 'done',
      action: 'complete',
      fields: { note: 'done', pr_url: '' },
    });
    if (event.kind === 'task.transitioned') {
      expect(event.payload.fields).toEqual({ note: 'done' });
      expect(Object.keys(event.payload.fields ?? {})).not.toContain('pr_url');
    }
  });

  it('OMITS an empty links array (also unreadable if written)', () => {
    const event = taskTransitioned(env, {
      from: 'in-progress',
      to: 'done',
      action: 'complete',
      fields: { note: 'done', links: [] },
    });
    if (event.kind === 'task.transitioned') {
      expect(event.payload.fields).toEqual({ note: 'done' });
    }
  });

  it('drops fields entirely when every field is empty', () => {
    const event = taskTransitioned(env, {
      from: 'a',
      to: 'b',
      action: 'go',
      fields: { reason: '', links: [] },
    });
    expect(Object.keys(event.payload)).not.toContain('fields');
  });

  it('carries links as an array and canonicalizes cleanly', () => {
    const event = taskTransitioned(env, {
      from: 'in-progress',
      to: 'done',
      action: 'complete',
      fields: { note: 'done', links: ['https://a', 'https://b'] },
    });
    if (event.kind === 'task.transitioned') {
      expect(event.payload.fields?.links).toEqual(['https://a', 'https://b']);
    }
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

describe('decision builders', () => {
  it('records a decision with its title, rationale, and frozen adr label', () => {
    const event = decisionRecorded(env, {
      title: 'Use SQLite for the cache',
      rationale: 'The load is relational; a rebuildable cache dissolves migrations.',
      adr: 'ADR-3',
    });
    expect(event).toMatchObject({
      v: 1,
      kind: 'decision.recorded',
      payload: {
        title: 'Use SQLite for the cache',
        rationale: 'The load is relational; a rebuildable cache dissolves migrations.',
        adr: 'ADR-3',
      },
    });
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });

  it('builds a decision.transitioned without `by` when it is not a supersede', () => {
    const event = decisionTransitioned(env, { from: 'proposed', to: 'accepted', action: 'accept' });
    expect(Object.keys(event.payload)).not.toContain('by');
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });

  it('carries `by` (the successor id) on a supersede', () => {
    const event = decisionTransitioned(env, {
      from: 'accepted',
      to: 'superseded',
      action: 'supersede',
      by: 'd-9f3a',
      fields: { reason: 'HMAC dropped; Ed25519 checkpoint covers it' },
    });
    if (event.kind === 'decision.transitioned') {
      expect(event.payload.by).toBe('d-9f3a');
      expect(event.payload.fields?.reason).toBe('HMAC dropped; Ed25519 checkpoint covers it');
    }
    expect(() => canonicalStringify(toCanonical(event))).not.toThrow();
  });

  it('OMITS an empty `by` so the line stays re-readable (symmetric with the parser)', () => {
    // An empty `by` would serialize but the parser rejects an empty string on
    // read. The builder drops it, so a caller cannot produce an unreadable line.
    const event = decisionTransitioned(env, {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      by: '',
    });
    expect(Object.keys(event.payload)).not.toContain('by');
  });
});

describe('decisionBirth', () => {
  it('emits the pair in order: recorded then the birth transition', () => {
    const [recorded, transitioned] = decisionBirth(env, {
      title: 'Fix the workflow',
      rationale: 'Because the why is the value.',
      adr: 'ADR-1',
      initial: 'proposed',
    });
    expect(recorded).toMatchObject({
      kind: 'decision.recorded',
      payload: {
        title: 'Fix the workflow',
        rationale: 'Because the why is the value.',
        adr: 'ADR-1',
      },
    });
    expect(transitioned).toMatchObject({
      kind: 'decision.transitioned',
      payload: { from: null, to: 'proposed', action: BIRTH_ACTION },
    });
  });

  it('stamps both events with the same envelope (one atomic fact)', () => {
    const [recorded, transitioned] = decisionBirth(
      { ...env, which: 'claude', run: 'r-1' },
      { title: 't', rationale: 'why', adr: 'ADR-2', initial: 'proposed' },
    );
    expect(recorded.subject).toBe(transitioned.subject);
    expect(recorded.at).toBe(transitioned.at);
    expect(recorded.who).toBe(transitioned.who);
    expect(recorded.which).toBe(transitioned.which);
    expect(recorded.run).toBe(transitioned.run);
  });
});
