/**
 * THE FOUR PROJECTIONS KEEP WHAT THE RECORD SAID — every move's proof, who acted, how many facts
 * a run held — AND INVENT NOTHING: a field the record never held is absent, not `undefined`, and
 * a subject with a birth and no move (or a move and no birth) is not projected.
 *
 * Each case is a whole projection compared strictly, so a key holding `undefined` is a failure.
 */

import {
  decisionBirth,
  decisionTransitioned,
  memoryCaptured,
  runEnded,
  runStarted,
  skillBirth,
  skillTransitioned,
  taskBirth,
  taskTransitioned,
} from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { adrCollisions, type DecisionProjection, projectDecisions } from './decision.js';
import { projectRuns } from './run.js';
import { projectSkills } from './skill.js';
import { projectTasks } from './task.js';

let tick = 0;
const env = (subject: string, extra: { which?: string; run?: string } = {}) => {
  tick += 1;
  return {
    at: `2026-10-01T00:00:${String(tick).padStart(2, '0')}.000Z`,
    who: 'mnid:aa',
    signerFp: 'fp-1',
    subject,
    ...extra,
  };
};

describe('a decision', () => {
  it('keeps the proof of every move, who recorded it and who accepted it', () => {
    const born = decisionBirth(env('d-1', { which: 'agent' }), {
      title: 't',
      rationale: 'r',
      adr: 'ADR-1',
      initial: 'proposed',
      alternatives: 'a',
    });
    const accepted = decisionTransitioned(env('d-1'), {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      fields: { note: 'because' },
    });
    const events = [...born, accepted];
    expect(projectDecisions(events).get('d-1')).toStrictEqual({
      id: 'd-1',
      adr: 'ADR-1',
      title: 't',
      rationale: 'r',
      alternatives: 'a',
      state: 'accepted',
      createdAt: born[0]?.at,
      updatedAt: accepted.at,
      proof: [{ action: 'accept', at: accepted.at, said: 'note: because' }],
      recordedBy: { who: 'mnid:aa', which: 'agent' },
      acceptedBy: { who: 'mnid:aa' },
    });
  });

  it('holds no key it has no value for', () => {
    const born = decisionBirth(env('d-2'), {
      title: 't',
      rationale: 'r',
      adr: 'ADR-2',
      initial: 'proposed',
    });
    const projected = projectDecisions(born).get('d-2') as DecisionProjection;
    expect(Object.keys(projected).sort()).toEqual([
      'adr',
      'createdAt',
      'id',
      'rationale',
      'recordedBy',
      'state',
      'title',
      'updatedAt',
    ]);
    expect(projected.recordedBy).toStrictEqual({ who: 'mnid:aa' });
  });

  it('links a supersede on both sides, and a successor with no record of its own is not projected', () => {
    const one = decisionBirth(env('d-3'), {
      title: 't',
      rationale: 'r',
      adr: 'ADR-3',
      initial: 'proposed',
    });
    const move = (to: string, action: string, by?: string) =>
      decisionTransitioned(env('d-3'), {
        from: 'proposed',
        to,
        action,
        ...(by === undefined ? {} : { by }),
        fields: { reason: 'r' },
      });
    const projected = projectDecisions([...one, move('superseded', 'supersede', 'd-ghost')]);
    expect(projected.get('d-3')?.supersededBy).toBe('d-ghost');
    expect(projected.has('d-ghost')).toBe(false);
  });

  it('projects neither a birth with no move nor a move with no birth', () => {
    const [recorded] = decisionBirth(env('d-4'), {
      title: 't',
      rationale: 'r',
      adr: 'ADR-4',
      initial: 'proposed',
    });
    const move = decisionTransitioned(env('d-5'), {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      fields: { note: 'n' },
    });
    expect(projectDecisions([recorded as never, move]).size).toBe(0);
  });

  it('names a label held twice, in the order of the labels, with its ids in order', () => {
    const decision = (id: string, adr: string) => ({ id, adr }) as unknown as DecisionProjection;
    expect(
      adrCollisions([
        decision('d-9', 'ADR-2'),
        decision('d-1', 'ADR-10'),
        decision('d-3', 'ADR-2'),
        decision('d-2', 'ADR-10'),
        decision('d-7', 'ADR-5'),
        decision('d-0', 'ADR-2'),
      ]),
    ).toEqual([
      { adr: 'ADR-10', ids: ['d-1', 'd-2'] },
      { adr: 'ADR-2', ids: ['d-0', 'd-3', 'd-9'] },
    ]);
  });
});

describe('a task', () => {
  it('keeps the proof of every move and omits it when none was said', () => {
    const born = taskBirth(env('t-1'), { title: 't', initial: 'DRAFT' });
    const submit = taskTransitioned(env('t-1'), { from: 'DRAFT', to: 'READY', action: 'submit' });
    expect(projectTasks([...born, submit]).get('t-1')).toStrictEqual({
      id: 't-1',
      title: 't',
      state: 'READY',
      createdAt: born[0]?.at,
      updatedAt: submit.at,
    });
    const cancel = taskTransitioned(env('t-1'), {
      from: 'READY',
      to: 'CANCELED',
      action: 'cancel',
      fields: { reason: 'no longer' },
    });
    expect(projectTasks([...born, submit, cancel]).get('t-1')).toStrictEqual({
      id: 't-1',
      title: 't',
      state: 'CANCELED',
      createdAt: born[0]?.at,
      updatedAt: cancel.at,
      proof: [{ action: 'cancel', at: cancel.at, said: 'reason: no longer' }],
    });
  });

  it('projects neither a birth with no move nor a move with no birth', () => {
    const [created] = taskBirth(env('t-2'), { title: 't', initial: 'DRAFT' });
    const move = taskTransitioned(env('t-3'), { from: 'DRAFT', to: 'READY', action: 'submit' });
    expect(projectTasks([created as never, move]).size).toBe(0);
  });
});

describe('a skill', () => {
  it('keeps who proposed it, the proof of every move and the adoption', () => {
    const born = skillBirth(env('s-1', { which: 'agent' }), {
      name: 'n',
      body: 'b',
      initial: 'proposed',
    });
    const review = skillTransitioned(env('s-1'), {
      from: 'proposed',
      to: 'reviewed',
      action: 'review',
      fields: { note: 'ok' },
    });
    const adopt = skillTransitioned(env('s-1', { which: 'other' }), {
      from: 'reviewed',
      to: 'adopted',
      action: 'adopt',
      fields: { note: 'yes' },
    });
    expect(projectSkills([...born, review, adopt]).get('s-1')).toStrictEqual({
      id: 's-1',
      name: 'n',
      body: 'b',
      state: 'adopted',
      createdAt: born[0]?.at,
      updatedAt: adopt.at,
      proposedBy: 'agent',
      proof: [
        { action: 'review', at: review.at, said: 'note: ok' },
        { action: 'adopt', at: adopt.at, said: 'note: yes' },
      ],
      adoption: { at: adopt.at, by: 'other' },
    });
  });

  it('names an adoption by a person without inventing who', () => {
    const born = skillBirth(env('s-2'), { name: 'n', body: 'b', initial: 'reviewed' });
    const adopt = skillTransitioned(env('s-2'), {
      from: 'reviewed',
      to: 'adopted',
      action: 'adopt',
      fields: { note: 'yes' },
    });
    const projected = projectSkills([...born, adopt]).get('s-2');
    expect(projected?.adoption).toStrictEqual({ at: adopt.at });
    expect(projected && 'proposedBy' in projected).toBe(false);
  });

  it('holds no proof for a move that said nothing, and no adoption before one', () => {
    const born = skillBirth(env('s-3'), { name: 'n', body: 'b', initial: 'proposed' });
    expect(projectSkills(born).get('s-3')).toStrictEqual({
      id: 's-3',
      name: 'n',
      body: 'b',
      state: 'proposed',
      createdAt: born[0]?.at,
      updatedAt: born[1]?.at,
    });
  });

  it('projects neither a birth with no move nor a move with no birth', () => {
    const [created] = skillBirth(env('s-4'), { name: 'n', body: 'b', initial: 'proposed' });
    const move = skillTransitioned(env('s-5'), {
      from: 'proposed',
      to: 'reviewed',
      action: 'review',
      fields: { note: 'n' },
    });
    expect(projectSkills([created as never, move]).size).toBe(0);
  });
});

describe('a run', () => {
  it('keeps the goal, the outcome, the last fact and what it wrote, most written first', () => {
    const start = runStarted(env('r-1'), { agent: 'agent', goal: 'g' });
    const note = (at: string, run = 'r-1') =>
      memoryCaptured({ ...env('m-1', { run }), at }, { content: 'c' });
    const events = [
      start,
      note('2026-10-01T00:05:00.000Z'),
      note('2026-10-01T00:09:00.000Z'),
      note('2026-10-01T00:07:00.000Z'),
      decisionBirth(
        { ...env('d-1', { run: 'r-1' }), at: '2026-10-01T00:04:00.000Z' },
        {
          title: 't',
          rationale: 'r',
          adr: 'ADR-1',
          initial: 'proposed',
        },
      )[0] as never,
      runEnded(env('r-1'), { outcome: 'done' }),
    ];
    expect(projectRuns(events).get('r-1')).toStrictEqual({
      id: 'r-1',
      agent: 'agent',
      who: 'mnid:aa',
      goal: 'g',
      outcome: 'done',
      open: false,
      startedAt: start.at,
      endedAt: (events[5] as { at: string }).at,
      lastFactAt: '2026-10-01T00:09:00.000Z',
      wrote: [
        { kind: 'memory.captured', count: 3 },
        { kind: 'decision.recorded', count: 1 },
      ],
    });
  });

  it('orders kinds written as often by their names', () => {
    const start = runStarted(env('r-2'), { agent: 'agent' });
    const [recorded] = decisionBirth(env('d-2', { run: 'r-2' }), {
      title: 't',
      rationale: 'r',
      adr: 'ADR-2',
      initial: 'proposed',
    });
    const [created] = taskBirth(env('t-1', { run: 'r-2' }), { title: 't', initial: 'DRAFT' });
    const memory = memoryCaptured(env('m-2', { run: 'r-2' }), { content: 'c' });
    for (const order of [
      [memory, recorded, created],
      [created, recorded, memory],
    ]) {
      expect(
        projectRuns([start, ...(order as never[])])
          .get('r-2')
          ?.wrote.map((w) => w.kind),
      ).toEqual(['decision.recorded', 'memory.captured', 'task.created']);
    }
  });

  it('is open with nothing pinned to it, and holds no goal, outcome or end it was not given', () => {
    const start = runStarted(env('r-3'), { agent: 'agent' });
    expect(projectRuns([start]).get('r-3')).toStrictEqual({
      id: 'r-3',
      agent: 'agent',
      who: 'mnid:aa',
      open: true,
      startedAt: start.at,
      wrote: [],
    });
  });

  it('ends without an outcome when none was said, and is not a run when it only ended', () => {
    const start = runStarted(env('r-4'), { agent: 'agent' });
    const end = runEnded(env('r-4'));
    const projected = projectRuns([start, end]).get('r-4');
    expect(projected && 'outcome' in projected).toBe(false);
    expect(projected?.open).toBe(false);
    expect(projectRuns([runEnded(env('r-5'))]).size).toBe(0);
  });
});
