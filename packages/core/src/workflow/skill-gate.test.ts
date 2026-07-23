import type { TransitionFields } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { skillGate } from './skill-gate.js';
import { SKILL_STATES } from './skill-states.js';
import { SKILL_ACTIONS, SKILL_TRANSITIONS, type SkillProofField } from './skill-transitions.js';

const WHO = 'felipe';
const WHICH = 'claude';

/** Builds a `fields` object satisfying exactly the given required fields. */
function proofFor(required: readonly SkillProofField[]): TransitionFields | undefined {
  if (required.length === 0) return undefined;
  const fields: Record<string, string> = {};
  for (const f of required) fields[f] = `${f}-value`;
  return fields as TransitionFields;
}

describe('skillGate — every legal transition passes with valid authority and proof', () => {
  for (const t of SKILL_TRANSITIONS) {
    it(`${t.from} --${t.action}--> ${t.to}`, () => {
      const result = skillGate({
        from: t.from,
        action: t.action,
        fields: proofFor(t.requires),
        who: WHO,
        which: WHICH,
      });
      expect(result).toEqual(
        t.requires.length === 0
          ? { ok: true, to: t.to, action: t.action }
          : { ok: true, to: t.to, action: t.action, fields: proofFor(t.requires) },
      );
    });
  }
});

describe('skillGate — legality (the forbidden moves are refused)', () => {
  it('rejects every (from, action) pair that is NOT a declared transition', () => {
    const legal = new Set(SKILL_TRANSITIONS.map((t) => `${t.from}::${t.action}`));
    let illegalChecked = 0;
    for (const from of SKILL_STATES) {
      for (const action of SKILL_ACTIONS) {
        if (legal.has(`${from}::${action}`)) continue;
        illegalChecked += 1;
        const result = skillGate({
          from,
          action,
          fields: proofFor(['note', 'reason']),
          who: WHO,
        });
        expect(result.ok, `${from} --${action}-->`).toBe(false);
        if (!result.ok) expect(result.code).toBe('ILLEGAL_TRANSITION');
      }
    }
    expect(illegalChecked).toBeGreaterThan(0);
  });

  it('refuses adopted --reject--> (an adopted skill is never rejected retroactively)', () => {
    const result = skillGate({
      from: 'adopted',
      action: 'reject',
      fields: { note: 'no' },
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });

  it('refuses any move out of a terminal state (deprecated, rejected)', () => {
    for (const from of ['deprecated', 'rejected'] as const) {
      for (const action of SKILL_ACTIONS) {
        const result = skillGate({
          from,
          action,
          fields: proofFor(['note', 'reason']),
          who: WHO,
        });
        expect(result.ok, `${from} --${action}-->`).toBe(false);
      }
    }
  });

  it('rejects an unknown state', () => {
    const result = skillGate({ from: 'NOPE', action: 'review', who: WHO });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_STATE' });
  });

  it('rejects an unknown action (including a decision-style supersede)', () => {
    expect(skillGate({ from: 'proposed', action: 'teleport', who: WHO })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_ACTION',
    });
    // `supersede` is a decision action, never a skill's — replacement is a link.
    expect(skillGate({ from: 'adopted', action: 'supersede', who: WHO })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_ACTION',
    });
  });

  it('rejects the birth action `create` as a gated move', () => {
    const result = skillGate({ from: 'proposed', action: 'create', who: WHO });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });
});

describe('skillGate — required proof', () => {
  const withReq = SKILL_TRANSITIONS.filter((t) => t.requires.length > 0);

  it('every skill move requires a why (guards the suite is meaningful)', () => {
    expect(withReq.length).toBe(SKILL_TRANSITIONS.length);
  });

  for (const t of withReq) {
    it(`${t.action} from ${t.from} rejects missing proof`, () => {
      const result = skillGate({ from: t.from, action: t.action, who: WHO });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: t.requires[0] });
    });

    it(`${t.action} from ${t.from} rejects a whitespace-only required field`, () => {
      const blank: Record<string, string> = {};
      for (const f of t.requires) blank[f] = '   ';
      const result = skillGate({
        from: t.from,
        action: t.action,
        fields: blank as TransitionFields,
        who: WHO,
      });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    });

    it(`${t.action} from ${t.from} rejects proof under the WRONG key`, () => {
      const wrong: Record<string, string> = {};
      const decoy = t.requires.includes('note') ? 'reason' : 'note';
      wrong[decoy] = 'decoy';
      const result = skillGate({
        from: t.from,
        action: t.action,
        fields: wrong as TransitionFields,
        who: WHO,
      });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: t.requires[0] });
    });
  }
});

describe('skillGate — authority (who != which)', () => {
  it('rejects a missing who', () => {
    const result = skillGate({ from: 'proposed', action: 'review', who: '' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_WHO' });
  });

  it('rejects who equal to which (an agent cannot self-authorize)', () => {
    const result = skillGate({
      from: 'proposed',
      action: 'review',
      fields: { note: 'n' },
      who: 'claude',
      which: 'claude',
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('checks authority before legality', () => {
    const result = skillGate({ from: 'rejected', action: 'review', who: 'x', which: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('rejects who and which differing only by whitespace', () => {
    const result = skillGate({
      from: 'proposed',
      action: 'review',
      fields: { note: 'n' },
      who: 'alice',
      which: 'alice ',
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('allows an absent which (a human acting directly)', () => {
    const result = skillGate({
      from: 'proposed',
      action: 'review',
      fields: { note: 'n' },
      who: WHO,
    });
    expect(result).toEqual({ ok: true, to: 'reviewed', action: 'review', fields: { note: 'n' } });
  });
});

describe('skillGate — never throws on untrusted junk', () => {
  const junk: unknown[] = [undefined, null, 5, {}, [], true];

  it('refuses a non-string who without throwing', () => {
    for (const bad of junk) {
      const call = () => skillGate({ from: 'proposed', action: 'review', who: bad as string });
      expect(call).not.toThrow();
      expect(call()).toMatchObject({ ok: false, code: 'MISSING_WHO' });
    }
  });

  it('does not crash on a non-object fields; treats missing proof as refused', () => {
    for (const bad of [null, 5, 'nope', []]) {
      const call = () =>
        skillGate({
          from: 'proposed',
          action: 'review',
          fields: bad as unknown as undefined,
          who: WHO,
        });
      expect(call).not.toThrow();
      expect(call()).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    }
  });
});

describe('skillGate — purity', () => {
  it('returns the same verdict for the same input, and never mutates the request', () => {
    const req = { from: 'reviewed' as const, action: 'adopt', fields: { note: 'yes' }, who: WHO };
    const a = skillGate(req);
    const b = skillGate(req);
    expect(a).toEqual(b);
    expect(req).toEqual({ from: 'reviewed', action: 'adopt', fields: { note: 'yes' }, who: WHO });
  });

  it('resolves `to` from the table, not from any caller assertion', () => {
    const result = skillGate({
      from: 'reviewed',
      action: 'adopt',
      fields: { note: 'n' },
      who: WHO,
    });
    if (result.ok) expect(result.to).toBe('adopted');
  });
});
