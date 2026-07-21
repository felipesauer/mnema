import { describe, expect, it } from 'vitest';
import { DECISION_STATES, INITIAL_DECISION_STATE, isDecisionState } from './decision-states.js';

describe('decision states', () => {
  it('has exactly the four workflow states', () => {
    expect([...DECISION_STATES]).toEqual(['proposed', 'accepted', 'rejected', 'superseded']);
  });

  it('is born proposed', () => {
    expect(INITIAL_DECISION_STATE).toBe('proposed');
    expect(isDecisionState(INITIAL_DECISION_STATE)).toBe(true);
  });

  it('isDecisionState recognizes only the known states', () => {
    for (const s of DECISION_STATES) expect(isDecisionState(s)).toBe(true);
    expect(isDecisionState('PROPOSED')).toBe(false); // case-sensitive
    expect(isDecisionState('done')).toBe(false);
    expect(isDecisionState('')).toBe(false);
  });
});
