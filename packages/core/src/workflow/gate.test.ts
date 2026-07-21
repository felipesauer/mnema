import type { TransitionFields } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { gate } from './gate.js';
import { TASK_STATES } from './states.js';
import { type ProofField, TASK_ACTIONS, TRANSITIONS } from './transitions.js';

const WHO = 'felipe';
const WHICH = 'claude';

/** Builds a `fields` object satisfying exactly the given required fields. */
function proofFor(required: readonly ProofField[]): TransitionFields | undefined {
  if (required.length === 0) return undefined;
  const fields: Record<string, string> = {};
  for (const f of required) fields[f] = `${f}-value`;
  return fields as TransitionFields;
}

describe('gate — every legal transition passes with valid authority and proof', () => {
  for (const t of TRANSITIONS) {
    it(`${t.from} --${t.action}--> ${t.to}`, () => {
      const result = gate({
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

describe('gate — legality', () => {
  it('rejects every (from, action) pair that is NOT a declared transition', () => {
    const legal = new Set(TRANSITIONS.map((t) => `${t.from}::${t.action}`));
    let illegalChecked = 0;
    for (const from of TASK_STATES) {
      for (const action of TASK_ACTIONS) {
        if (legal.has(`${from}::${action}`)) continue;
        illegalChecked += 1;
        const result = gate({
          from,
          action,
          fields: proofFor(['reason', 'note', 'feedback']),
          who: WHO,
        });
        expect(result.ok, `${from} --${action}-->`).toBe(false);
        if (!result.ok) expect(result.code).toBe('ILLEGAL_TRANSITION');
      }
    }
    // Sanity: there really are illegal pairs being exercised, not an empty loop.
    expect(illegalChecked).toBeGreaterThan(0);
  });

  it('rejects an unknown state', () => {
    const result = gate({ from: 'NOPE', action: 'start', who: WHO });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_STATE' });
  });

  it('rejects an unknown action', () => {
    const result = gate({ from: 'READY', action: 'teleport', who: WHO });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('rejects the birth action `create` as a gated move (it is never requestable)', () => {
    const result = gate({ from: 'DRAFT', action: 'create', who: WHO });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });
});

describe('gate — required proof', () => {
  const withReq = TRANSITIONS.filter((t) => t.requires.length > 0);

  it('there are transitions that require proof (guards the suite is meaningful)', () => {
    expect(withReq.length).toBeGreaterThan(0);
  });

  for (const t of withReq) {
    it(`${t.action} from ${t.from} rejects missing proof (no fields at all)`, () => {
      const result = gate({ from: t.from, action: t.action, who: WHO });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: t.requires[0] });
    });

    it(`${t.action} from ${t.from} rejects an empty-string required field`, () => {
      const empty: Record<string, string> = {};
      for (const f of t.requires) empty[f] = '';
      const result = gate({
        from: t.from,
        action: t.action,
        fields: empty as TransitionFields,
        who: WHO,
      });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    });

    it(`${t.action} from ${t.from} rejects proof present but under the WRONG key`, () => {
      // A note where a reason is required (or vice versa) must not satisfy the
      // requirement — the gate checks the specific field, not "some field".
      const wrong: Record<string, string> = {};
      const decoy: ProofField = t.requires.includes('reason') ? 'note' : 'reason';
      wrong[decoy] = 'decoy';
      const result = gate({
        from: t.from,
        action: t.action,
        fields: wrong as TransitionFields,
        who: WHO,
      });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: t.requires[0] });
    });
  }
});

describe('gate — optional fields', () => {
  it('a transition that requires nothing passes with no fields', () => {
    const result = gate({ from: 'DRAFT', action: 'submit', who: WHO });
    expect(result).toEqual({ ok: true, to: 'READY', action: 'submit' });
  });

  it('optional pr_url and links pass and are carried through', () => {
    const fields: TransitionFields = { note: 'done', pr_url: 'https://x/1', links: ['https://y'] };
    const result = gate({
      from: 'IN_PROGRESS',
      action: 'complete',
      fields,
      who: WHO,
      which: WHICH,
    });
    expect(result).toEqual({ ok: true, to: 'DONE', action: 'complete', fields });
  });

  it('a no-requirement action still carries optional fields when supplied', () => {
    const fields: TransitionFields = { note: 'context' };
    const result = gate({ from: 'IN_PROGRESS', action: 'submit_review', fields, who: WHO });
    expect(result).toEqual({ ok: true, to: 'IN_REVIEW', action: 'submit_review', fields });
  });

  it('never requires pr_url (local-first: work need not use git)', () => {
    // Exhaustive guard on the design rule: no transition lists pr_url or links.
    for (const t of TRANSITIONS) {
      expect(t.requires).not.toContain('pr_url');
      expect(t.requires).not.toContain('links');
    }
  });
});

describe('gate — authority (who != which)', () => {
  it('rejects a missing who', () => {
    const result = gate({ from: 'READY', action: 'start', who: '' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_WHO' });
  });

  it('rejects who equal to which (an agent cannot self-authorize)', () => {
    const result = gate({ from: 'READY', action: 'start', who: 'claude', which: 'claude' });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('allows an absent which (a human acting directly)', () => {
    const result = gate({ from: 'READY', action: 'start', who: WHO });
    expect(result).toEqual({ ok: true, to: 'IN_PROGRESS', action: 'start' });
  });

  it('allows who and which that differ', () => {
    const result = gate({ from: 'READY', action: 'start', who: WHO, which: WHICH });
    expect(result).toEqual({ ok: true, to: 'IN_PROGRESS', action: 'start' });
  });

  it('checks authority before legality (a self-authorized illegal move reports the identity fault)', () => {
    // Ordering matters for a precise reason: the identity invariant holds
    // regardless of the move, so it is reported even when the move is also
    // illegal — the caller fixes the more fundamental fault first.
    const result = gate({ from: 'DONE', action: 'submit', who: 'x', which: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });
});

describe('gate — purity', () => {
  it('returns the same verdict for the same input, and never mutates the request', () => {
    const req = { from: 'IN_PROGRESS', action: 'complete', fields: { note: 'x' }, who: WHO };
    const a = gate(req);
    const b = gate(req);
    expect(a).toEqual(b);
    // The request object is untouched.
    expect(req).toEqual({
      from: 'IN_PROGRESS',
      action: 'complete',
      fields: { note: 'x' },
      who: WHO,
    });
  });

  it('resolves `to` from the table, not from any caller assertion', () => {
    // There is no `to` in the request; the gate can only get it from the table.
    const result = gate({ from: 'READY', action: 'start', who: WHO });
    if (result.ok) expect(result.to).toBe('IN_PROGRESS');
  });
});
