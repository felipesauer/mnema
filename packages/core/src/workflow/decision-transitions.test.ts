import { describe, expect, it } from 'vitest';
import { DECISION_STATES, isDecisionState } from './decision-states.js';
import {
  DECISION_ACTIONS,
  DECISION_TRANSITIONS,
  type DecisionAction,
  findDecisionTransition,
} from './decision-transitions.js';

/** The proof fields the catalog defines; a `requires` entry must be one of these. */
const PROOF_FIELDS = ['reason', 'note', 'feedback', 'pr_url', 'links'] as const;

describe('the decision transition table is well-formed', () => {
  it('every from and to is a known state', () => {
    for (const t of DECISION_TRANSITIONS) {
      expect(isDecisionState(t.from), `from ${t.from}`).toBe(true);
      expect(isDecisionState(t.to), `to ${t.to}`).toBe(true);
    }
  });

  it('every action is a known action', () => {
    for (const t of DECISION_TRANSITIONS) {
      expect(DECISION_ACTIONS as readonly string[]).toContain(t.action);
    }
  });

  it('every required field is a real proof field', () => {
    for (const t of DECISION_TRANSITIONS) {
      for (const field of t.requires) {
        expect(PROOF_FIELDS as readonly string[]).toContain(field);
      }
    }
  });

  it('has at most one row per (from, action) pair', () => {
    const seen = new Set<string>();
    for (const t of DECISION_TRANSITIONS) {
      const key = `${t.from}::${t.action}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('never lists `create` — birth is not a gated transition', () => {
    expect(DECISION_TRANSITIONS.some((t) => (t.action as string) === 'create')).toBe(false);
    expect(DECISION_ACTIONS as readonly string[]).not.toContain('create');
  });

  it('supersede is legal from both proposed and accepted, and nowhere else', () => {
    const supersedeFroms = DECISION_TRANSITIONS.filter((t) => t.action === 'supersede').map(
      (t) => t.from,
    );
    expect(new Set(supersedeFroms)).toEqual(new Set(['proposed', 'accepted']));
  });

  it('rejected and superseded are terminal (no outgoing moves)', () => {
    const hasOutgoing = new Set(DECISION_TRANSITIONS.map((t) => t.from));
    expect(hasOutgoing.has('rejected')).toBe(false);
    expect(hasOutgoing.has('superseded')).toBe(false);
  });

  it('reaches every non-initial state', () => {
    const reachable = new Set(DECISION_TRANSITIONS.map((t) => t.to));
    for (const s of DECISION_STATES) {
      if (s !== 'proposed') expect(reachable.has(s), `${s} reachable`).toBe(true);
    }
  });
});

describe('findDecisionTransition', () => {
  it('finds each declared transition', () => {
    for (const t of DECISION_TRANSITIONS) {
      expect(findDecisionTransition(t.from, t.action)).toEqual(t);
    }
  });

  it('returns undefined for an undeclared (from, action) pair', () => {
    expect(findDecisionTransition('rejected', 'accept' as DecisionAction)).toBeUndefined();
    expect(findDecisionTransition('superseded', 'supersede' as DecisionAction)).toBeUndefined();
    expect(findDecisionTransition('accepted', 'reject' as DecisionAction)).toBeUndefined();
  });
});
