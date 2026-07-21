import { describe, expect, it } from 'vitest';
import { isTaskState, TASK_STATES } from './states.js';
import { findTransition, TASK_ACTIONS, type TaskAction, TRANSITIONS } from './transitions.js';

/** The proof fields the catalog defines; a `requires` entry must be one of these. */
const PROOF_FIELDS = ['reason', 'note', 'feedback', 'pr_url', 'links'] as const;

describe('the transition table is well-formed', () => {
  it('every from and to is a known state', () => {
    for (const t of TRANSITIONS) {
      expect(isTaskState(t.from), `from ${t.from}`).toBe(true);
      expect(isTaskState(t.to), `to ${t.to}`).toBe(true);
    }
  });

  it('every action is a known action', () => {
    for (const t of TRANSITIONS) {
      expect(TASK_ACTIONS as readonly string[]).toContain(t.action);
    }
  });

  it('every required field is a real proof field', () => {
    for (const t of TRANSITIONS) {
      for (const field of t.requires) {
        expect(PROOF_FIELDS as readonly string[]).toContain(field);
      }
    }
  });

  it('has at most one row per (from, action) pair', () => {
    const seen = new Set<string>();
    for (const t of TRANSITIONS) {
      const key = `${t.from}::${t.action}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('never lists `create` — birth is not a gated transition', () => {
    expect(TRANSITIONS.some((t) => (t.action as string) === 'create')).toBe(false);
    expect(TASK_ACTIONS as readonly string[]).not.toContain('create');
  });

  it('reaches every non-initial state and leaves every non-terminal state', () => {
    // Sanity that the graph is connected the way the workflow intends: every
    // state except the two terminals has an outgoing move, and every state
    // except DRAFT is reachable.
    const reachable = new Set(TRANSITIONS.map((t) => t.to));
    const hasOutgoing = new Set(TRANSITIONS.map((t) => t.from));
    for (const s of TASK_STATES) {
      if (s !== 'DRAFT') expect(reachable.has(s), `${s} reachable`).toBe(true);
      if (s !== 'DONE' && s !== 'CANCELED') {
        expect(hasOutgoing.has(s), `${s} has an outgoing move`).toBe(true);
      }
    }
  });
});

describe('findTransition', () => {
  it('finds each declared transition', () => {
    for (const t of TRANSITIONS) {
      expect(findTransition(t.from, t.action)).toEqual(t);
    }
  });

  it('returns undefined for an undeclared (from, action) pair', () => {
    expect(findTransition('DONE', 'submit' as TaskAction)).toBeUndefined();
    expect(findTransition('DRAFT', 'complete' as TaskAction)).toBeUndefined();
  });
});
