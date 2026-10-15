/**
 * THE THREE GATES REFUSE IN WORDS, AND HAND BACK EXACTLY WHAT WAS PROVED.
 *
 * Each case here is the whole verdict, not its code: the line a refusal prints is what the person
 * at the other end reads, and a gate that returns more than it was handed (an empty `by`, a
 * `fields` of `undefined`) writes more than was proved. A proof that is absent altogether is a
 * refusal, not an exception, whatever the surface forwarded.
 */

import { describe, expect, it } from 'vitest';
import { type DecisionGateRequest, decisionGate } from './decision-gate.js';
import { type GateRequest, gate } from './gate.js';
import { type SkillGateRequest, skillGate } from './skill-gate.js';

const who = 'alice';

describe('the decision gate', () => {
  const accept: DecisionGateRequest = {
    from: 'proposed',
    action: 'accept',
    fields: { note: 'because' },
    subject: 'd-1',
    who,
  };
  const refusal = (request: Partial<DecisionGateRequest>) =>
    decisionGate({ ...accept, ...request });

  it('says who is missing', () => {
    expect(refusal({ who: ' ' })).toEqual({
      ok: false,
      code: 'MISSING_WHO',
      message: 'a decision transition needs a human who authorized it',
    });
  });

  it('says a state, an action and a pair that are not the workflow', () => {
    expect(refusal({ from: 'pro\nposed' })).toEqual({
      ok: false,
      code: 'UNKNOWN_STATE',
      message: '"pro posed" is not a decision state',
    });
    expect(refusal({ action: 'ap\nprove' })).toEqual({
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: '"ap prove" is not a decision action',
    });
    expect(refusal({ from: 'rejected' })).toEqual({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: 'cannot "accept" a decision in rejected',
    });
  });

  it('says the proof a move lacks, whether it is blank, absent, or the whole of it is missing', () => {
    const lacking = {
      ok: false,
      code: 'MISSING_PROOF',
      message: '"accept" requires a non-empty "note"',
      field: 'note',
    };
    expect(refusal({ fields: { note: '  ' } })).toEqual(lacking);
    expect(refusal({ fields: {} })).toEqual(lacking);
    expect(refusal({ fields: undefined })).toEqual(lacking);
    expect(refusal({ fields: null as never })).toEqual(lacking);
  });

  it('says a supersede names a successor that is not itself, and nothing else does', () => {
    const supersede = {
      from: 'accepted',
      action: 'supersede',
      fields: { reason: 'because' },
    };
    expect(refusal(supersede)).toEqual({
      ok: false,
      code: 'MISSING_BY',
      message: 'a supersede must name the successor decision "by"',
    });
    expect(refusal({ ...supersede, by: 'd-1' })).toEqual({
      ok: false,
      code: 'SELF_SUPERSEDE',
      message: 'a decision cannot supersede itself',
    });
    expect(refusal({ ...supersede, by: 'd-2' })).toStrictEqual({
      ok: true,
      to: 'superseded',
      action: 'supersede',
      by: 'd-2',
      fields: { reason: 'because' },
    });
    expect(refusal({ by: 'd-2' })).toEqual({
      ok: false,
      code: 'UNEXPECTED_BY',
      message: '"accept" does not take a successor "by"',
    });
  });

  it('hands back what was proved and no more', () => {
    expect(refusal({})).toStrictEqual({
      ok: true,
      to: 'accepted',
      action: 'accept',
      fields: { note: 'because' },
    });
  });
});

describe('the task gate', () => {
  const submit: GateRequest = { from: 'DRAFT', action: 'submit', who };

  it('says who is missing, and a state, an action and a pair that are not the workflow', () => {
    expect(gate({ ...submit, who: '' })).toEqual({
      ok: false,
      code: 'MISSING_WHO',
      message: 'a transition needs a human who authorized it',
    });
    expect(gate({ ...submit, from: 'DR\nAFT' })).toEqual({
      ok: false,
      code: 'UNKNOWN_STATE',
      message: '"DR AFT" is not a workflow state',
    });
    expect(gate({ ...submit, action: 'sub\nmit' })).toEqual({
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: '"sub mit" is not a workflow action',
    });
    expect(gate({ ...submit, from: 'DONE' })).toEqual({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: 'cannot "submit" a task in DONE',
    });
  });

  it('says the proof a move lacks, whether it is blank, absent, or the whole of it is missing', () => {
    const cancel = { from: 'DRAFT', action: 'cancel', who };
    const lacking = {
      ok: false,
      code: 'MISSING_PROOF',
      message: '"cancel" requires a non-empty "reason"',
      field: 'reason',
    };
    expect(gate({ ...cancel, fields: { reason: ' ' } })).toEqual(lacking);
    expect(gate({ ...cancel, fields: {} })).toEqual(lacking);
    expect(gate(cancel)).toEqual(lacking);
    expect(gate({ ...cancel, fields: null as never })).toEqual(lacking);
  });

  it('hands back what was proved, and no `fields` when none was', () => {
    expect(gate(submit)).toStrictEqual({ ok: true, to: 'READY', action: 'submit' });
    expect(gate({ ...submit, fields: { note: 'n' } })).toStrictEqual({
      ok: true,
      to: 'READY',
      action: 'submit',
      fields: { note: 'n' },
    });
  });
});

describe('the skill gate', () => {
  const review: SkillGateRequest = {
    from: 'proposed',
    action: 'review',
    fields: { note: 'n' },
    who,
  };

  it('says who is missing, and a state, an action and a pair that are not the workflow', () => {
    expect(skillGate({ ...review, who: '' })).toEqual({
      ok: false,
      code: 'MISSING_WHO',
      message: 'a transition needs a human who authorized it',
    });
    expect(skillGate({ ...review, from: 'pro\nposed' })).toEqual({
      ok: false,
      code: 'UNKNOWN_STATE',
      message: '"pro posed" is not a skill state',
    });
    expect(skillGate({ ...review, action: 'rev\niew' })).toEqual({
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: '"rev iew" is not a skill action',
    });
    expect(skillGate({ ...review, from: 'adopted' })).toEqual({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: 'cannot "review" a skill in adopted',
    });
  });

  it('says the proof a move lacks, whether it is blank, absent, or the whole of it is missing', () => {
    const lacking = {
      ok: false,
      code: 'MISSING_PROOF',
      message: '"review" requires a non-empty "note"',
      field: 'note',
    };
    expect(skillGate({ ...review, fields: { note: ' ' } })).toEqual(lacking);
    expect(skillGate({ ...review, fields: {} })).toEqual(lacking);
    expect(skillGate({ ...review, fields: undefined })).toEqual(lacking);
    expect(skillGate({ ...review, fields: null as never })).toEqual(lacking);
  });

  it('hands back what was proved', () => {
    expect(skillGate(review)).toStrictEqual({
      ok: true,
      to: 'reviewed',
      action: 'review',
      fields: { note: 'n' },
    });
  });
});
