import { describe, expect, it } from 'vitest';
import { isSkillState, SKILL_STATES } from './skill-states.js';
import {
  findSkillTransition,
  SKILL_ACTIONS,
  SKILL_TRANSITIONS,
  type SkillAction,
} from './skill-transitions.js';

/** The proof fields the catalog defines; a `requires` entry must be one of these. */
const PROOF_FIELDS = ['reason', 'note', 'feedback', 'pr_url', 'links'] as const;

describe('the skill transition table is well-formed', () => {
  it('every from and to is a known state', () => {
    for (const t of SKILL_TRANSITIONS) {
      expect(isSkillState(t.from), `from ${t.from}`).toBe(true);
      expect(isSkillState(t.to), `to ${t.to}`).toBe(true);
    }
  });

  it('every action is a known action', () => {
    for (const t of SKILL_TRANSITIONS) {
      expect(SKILL_ACTIONS as readonly string[]).toContain(t.action);
    }
  });

  it('every required field is a real proof field', () => {
    for (const t of SKILL_TRANSITIONS) {
      for (const field of t.requires) {
        expect(PROOF_FIELDS as readonly string[]).toContain(field);
      }
    }
  });

  it('has at most one row per (from, action) pair', () => {
    const seen = new Set<string>();
    for (const t of SKILL_TRANSITIONS) {
      const key = `${t.from}::${t.action}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('never lists `create` — birth is not a gated transition', () => {
    expect(SKILL_TRANSITIONS.some((t) => (t.action as string) === 'create')).toBe(false);
    expect(SKILL_ACTIONS as readonly string[]).not.toContain('create');
  });

  it('is NOT relational — no action carries a decision-style `supersede`', () => {
    expect(SKILL_ACTIONS as readonly string[]).not.toContain('supersede');
  });

  it('reject is legal from both proposed and reviewed, and nowhere else', () => {
    const rejectFroms = SKILL_TRANSITIONS.filter((t) => t.action === 'reject').map((t) => t.from);
    expect(new Set(rejectFroms)).toEqual(new Set(['proposed', 'reviewed']));
  });

  it('deprecate is the ONLY way out of adopted', () => {
    const fromAdopted = SKILL_TRANSITIONS.filter((t) => t.from === 'adopted');
    expect(fromAdopted.map((t) => t.action)).toEqual(['deprecate']);
    expect(fromAdopted[0]?.to).toBe('deprecated');
  });

  it('rejected and deprecated are terminal (no outgoing moves)', () => {
    const hasOutgoing = new Set(SKILL_TRANSITIONS.map((t) => t.from));
    expect(hasOutgoing.has('rejected')).toBe(false);
    expect(hasOutgoing.has('deprecated')).toBe(false);
  });

  it('reaches every non-initial state', () => {
    const reachable = new Set(SKILL_TRANSITIONS.map((t) => t.to));
    for (const s of SKILL_STATES) {
      if (s !== 'proposed') expect(reachable.has(s), `${s} reachable`).toBe(true);
    }
  });
});

describe('findSkillTransition', () => {
  it('finds each declared transition', () => {
    for (const t of SKILL_TRANSITIONS) {
      expect(findSkillTransition(t.from, t.action)).toEqual(t);
    }
  });

  it('returns undefined for an undeclared (from, action) pair', () => {
    // These are the forbidden moves the design names explicitly.
    expect(findSkillTransition('adopted', 'reject' as SkillAction)).toBeUndefined();
    expect(findSkillTransition('deprecated', 'deprecate' as SkillAction)).toBeUndefined();
    expect(findSkillTransition('rejected', 'review' as SkillAction)).toBeUndefined();
    expect(findSkillTransition('proposed', 'adopt' as SkillAction)).toBeUndefined();
  });
});
