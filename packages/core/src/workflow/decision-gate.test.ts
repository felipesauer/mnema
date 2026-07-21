import type { TransitionFields } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { decisionGate } from './decision-gate.js';
import { DECISION_STATES } from './decision-states.js';
import {
  DECISION_ACTIONS,
  DECISION_TRANSITIONS,
  type DecisionAction,
  type DecisionProofField,
} from './decision-transitions.js';

const WHO = 'felipe';
const WHICH = 'claude';
const SUBJECT = 'd-1';
const BY = 'd-2';

/** Builds a `fields` object satisfying exactly the given required fields. */
function proofFor(required: readonly DecisionProofField[]): TransitionFields | undefined {
  if (required.length === 0) return undefined;
  const fields: Record<string, string> = {};
  for (const f of required) fields[f] = `${f}-value`;
  return fields as TransitionFields;
}

/** A supersede needs a `by`; everything else must not have one. */
function byFor(action: DecisionAction): string | undefined {
  return action === 'supersede' ? BY : undefined;
}

describe('decisionGate — every legal transition passes with valid authority, proof, and by', () => {
  for (const t of DECISION_TRANSITIONS) {
    it(`${t.from} --${t.action}--> ${t.to}`, () => {
      const result = decisionGate({
        from: t.from,
        action: t.action,
        fields: proofFor(t.requires),
        by: byFor(t.action),
        subject: SUBJECT,
        who: WHO,
        which: WHICH,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) {
        expect(result.to).toBe(t.to);
        expect(result.action).toBe(t.action);
        if (t.action === 'supersede') expect(result.by).toBe(BY);
        else expect(result.by).toBeUndefined();
      }
    });
  }
});

describe('decisionGate — legality', () => {
  it('rejects every (from, action) pair that is NOT a declared transition', () => {
    const legal = new Set(DECISION_TRANSITIONS.map((t) => `${t.from}::${t.action}`));
    let illegalChecked = 0;
    for (const from of DECISION_STATES) {
      for (const action of DECISION_ACTIONS) {
        if (legal.has(`${from}::${action}`)) continue;
        illegalChecked += 1;
        const result = decisionGate({
          from,
          action,
          fields: proofFor(['reason', 'note']),
          by: byFor(action),
          subject: SUBJECT,
          who: WHO,
        });
        expect(result.ok, `${from} --${action}-->`).toBe(false);
        if (!result.ok) expect(result.code).toBe('ILLEGAL_TRANSITION');
      }
    }
    expect(illegalChecked).toBeGreaterThan(0);
  });

  it('rejects an unknown state', () => {
    const result = decisionGate({
      from: 'NOPE',
      action: 'accept',
      subject: SUBJECT,
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_STATE' });
  });

  it('rejects an unknown action', () => {
    const result = decisionGate({
      from: 'proposed',
      action: 'teleport',
      subject: SUBJECT,
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('rejects the birth action `create` as a gated move', () => {
    const result = decisionGate({
      from: 'proposed',
      action: 'create',
      subject: SUBJECT,
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });
});

describe('decisionGate — required proof', () => {
  const withReq = DECISION_TRANSITIONS.filter((t) => t.requires.length > 0);

  it('there are transitions that require proof (guards the suite is meaningful)', () => {
    expect(withReq.length).toBe(DECISION_TRANSITIONS.length); // every decision move needs a why
  });

  for (const t of withReq) {
    it(`${t.action} from ${t.from} rejects missing proof`, () => {
      const result = decisionGate({
        from: t.from,
        action: t.action,
        by: byFor(t.action),
        subject: SUBJECT,
        who: WHO,
      });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: t.requires[0] });
    });

    it(`${t.action} from ${t.from} rejects a whitespace-only required field`, () => {
      const blank: Record<string, string> = {};
      for (const f of t.requires) blank[f] = '   ';
      const result = decisionGate({
        from: t.from,
        action: t.action,
        fields: blank as TransitionFields,
        by: byFor(t.action),
        subject: SUBJECT,
        who: WHO,
      });
      expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    });
  }
});

describe('decisionGate — supersede shape (by)', () => {
  it('rejects a supersede with no by', () => {
    const result = decisionGate({
      from: 'accepted',
      action: 'supersede',
      fields: { reason: 'replaced' },
      subject: SUBJECT,
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_BY' });
  });

  it('rejects a supersede that names itself as its successor', () => {
    const result = decisionGate({
      from: 'accepted',
      action: 'supersede',
      fields: { reason: 'replaced' },
      by: SUBJECT,
      subject: SUBJECT,
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'SELF_SUPERSEDE' });
  });

  it('rejects a self-supersede that differs only by whitespace/composition', () => {
    // A lookalike spelling of the subject must not slip past the self check —
    // the same canonicalization reasoning as who != which.
    for (const by of [`${SUBJECT} `, ` ${SUBJECT}`, `${SUBJECT}\n`]) {
      const result = decisionGate({
        from: 'accepted',
        action: 'supersede',
        fields: { reason: 'r' },
        by,
        subject: SUBJECT,
        who: WHO,
      });
      expect(result, JSON.stringify(by)).toMatchObject({ ok: false, code: 'SELF_SUPERSEDE' });
    }
  });

  it('rejects a by supplied on a non-supersede action', () => {
    for (const action of ['accept', 'reject'] as const) {
      const result = decisionGate({
        from: 'proposed',
        action,
        fields: { note: 'n' },
        by: BY,
        subject: SUBJECT,
        who: WHO,
      });
      expect(result, action).toMatchObject({ ok: false, code: 'UNEXPECTED_BY' });
    }
  });

  it('records the canonical by (trimmed), not the raw input', () => {
    const result = decisionGate({
      from: 'accepted',
      action: 'supersede',
      fields: { reason: 'r' },
      by: `  ${BY}  `,
      subject: SUBJECT,
      who: WHO,
    });
    if (result.ok) expect(result.by).toBe(BY);
  });

  it('treats a whitespace-only by as missing on a supersede', () => {
    const result = decisionGate({
      from: 'accepted',
      action: 'supersede',
      fields: { reason: 'r' },
      by: '   ',
      subject: SUBJECT,
      who: WHO,
    });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_BY' });
  });
});

describe('decisionGate — authority (who != which)', () => {
  it('rejects a missing who', () => {
    const result = decisionGate({ from: 'proposed', action: 'accept', subject: SUBJECT, who: '' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_WHO' });
  });

  it('rejects who equal to which', () => {
    const result = decisionGate({
      from: 'proposed',
      action: 'accept',
      fields: { note: 'n' },
      subject: SUBJECT,
      who: 'claude',
      which: 'claude',
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('checks authority before legality', () => {
    const result = decisionGate({
      from: 'rejected',
      action: 'accept',
      subject: SUBJECT,
      who: 'x',
      which: 'x',
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('rejects who and which differing only by whitespace', () => {
    const result = decisionGate({
      from: 'proposed',
      action: 'accept',
      fields: { note: 'n' },
      subject: SUBJECT,
      who: 'alice',
      which: 'alice ',
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });
});

describe('decisionGate — never throws on untrusted junk', () => {
  const junk: unknown[] = [undefined, null, 5, {}, [], true];

  it('refuses a non-string who without throwing', () => {
    for (const bad of junk) {
      const call = () =>
        decisionGate({ from: 'proposed', action: 'accept', subject: SUBJECT, who: bad as string });
      expect(call).not.toThrow();
      expect(call()).toMatchObject({ ok: false, code: 'MISSING_WHO' });
    }
  });

  it('refuses a non-string by on a supersede (treated as missing) without throwing', () => {
    for (const bad of junk) {
      const call = () =>
        decisionGate({
          from: 'accepted',
          action: 'supersede',
          fields: { reason: 'r' },
          by: bad as string,
          subject: SUBJECT,
          who: WHO,
        });
      expect(call).not.toThrow();
      expect(call()).toMatchObject({ ok: false, code: 'MISSING_BY' });
    }
  });
});

describe('decisionGate — purity', () => {
  it('returns the same verdict for the same input, and never mutates the request', () => {
    const req = {
      from: 'accepted' as const,
      action: 'supersede',
      fields: { reason: 'r' },
      by: BY,
      subject: SUBJECT,
      who: WHO,
    };
    const a = decisionGate(req);
    const b = decisionGate(req);
    expect(a).toEqual(b);
    expect(req).toEqual({
      from: 'accepted',
      action: 'supersede',
      fields: { reason: 'r' },
      by: BY,
      subject: SUBJECT,
      who: WHO,
    });
  });

  it('resolves `to` from the table, not from any caller assertion', () => {
    const result = decisionGate({
      from: 'proposed',
      action: 'accept',
      fields: { note: 'n' },
      subject: SUBJECT,
      who: WHO,
    });
    if (result.ok) expect(result.to).toBe('accepted');
  });
});
