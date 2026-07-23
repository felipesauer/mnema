import { describe, expect, it } from 'vitest';
import { INITIAL_SKILL_STATE, isSkillState, SKILL_STATES } from './skill-states.js';

describe('skill states', () => {
  it('has exactly the five workflow states', () => {
    expect([...SKILL_STATES]).toEqual([
      'proposed',
      'reviewed',
      'adopted',
      'rejected',
      'deprecated',
    ]);
  });

  it('is born proposed', () => {
    expect(INITIAL_SKILL_STATE).toBe('proposed');
    expect(isSkillState(INITIAL_SKILL_STATE)).toBe(true);
  });

  it('isSkillState recognizes only the known states', () => {
    for (const s of SKILL_STATES) expect(isSkillState(s)).toBe(true);
    expect(isSkillState('PROPOSED')).toBe(false); // case-sensitive
    expect(isSkillState('superseded')).toBe(false); // a decision state, not a skill's
    expect(isSkillState('')).toBe(false);
  });
});
