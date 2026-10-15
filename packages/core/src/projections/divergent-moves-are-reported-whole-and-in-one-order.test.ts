/**
 * THE DIVERGENT MOVES ARE REPORTED WHOLE AND IN ONE ORDER, for each of the three machines.
 *
 * `divergent-moves.test.ts` makes its records the way two clones make them. These hand the
 * function the events themselves, to pin what a clone record cannot reach: the order the moves
 * are reported in (kind, then entity, then state), the skill machine beside the decision's, what
 * the birth and a move of another subject are not, and how many moves one task report holds.
 */

import { decisionTransitioned, skillTransitioned, taskTransitioned } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { type DivergentMove, divergentMoves, sortDivergent } from './divergent-moves.js';

let tick = 0;
const env = (subject: string, who = 'mnid:aa') => {
  tick += 1;
  return {
    at: `2026-10-01T00:00:${String(tick % 60).padStart(2, '0')}.000Z`,
    who,
    signerFp: `fp-${who}`,
    subject,
  };
};

const decision = (subject: string, from: string | null, to: string, who?: string) =>
  decisionTransitioned(env(subject, who), {
    from,
    to,
    action: from === null ? 'create' : to === 'accepted' ? 'accept' : 'reject',
    ...(from === null ? {} : { fields: { note: 'n' } }),
  });
const skill = (subject: string, from: string | null, to: string, who?: string) =>
  skillTransitioned(env(subject, who), {
    from,
    to,
    action: from === null ? 'create' : to === 'reviewed' ? 'review' : 'reject',
    ...(from === null ? {} : { fields: { note: 'n' } }),
  });
const task = (subject: string, from: string | null, to: string, action: string, who?: string) =>
  taskTransitioned(env(subject, who), {
    from,
    to,
    action,
    ...(action === 'cancel' ? { fields: { reason: 'r' } } : {}),
  });

const summary = (moves: readonly DivergentMove[]) =>
  moves.map((m) => ({ kind: m.kind, id: m.entityId, from: m.from, to: m.to }));

describe('a decision and a skill that were each moved twice out of one state', () => {
  it('names the skill machine as such, and the states each move went to', () => {
    const events = [
      skill('s-1', null, 'proposed'),
      skill('s-1', 'proposed', 'reviewed', 'mnid:aa'),
      skill('s-1', 'proposed', 'rejected', 'mnid:bb'),
    ];
    expect(summary(divergentMoves(events))).toEqual([
      { kind: 'skill', id: 's-1', from: 'proposed', to: ['reviewed', 'rejected'] },
    ]);
  });

  it('names the decision machine as such', () => {
    const events = [
      decision('d-1', null, 'proposed'),
      decision('d-1', 'proposed', 'accepted', 'mnid:aa'),
      decision('d-1', 'proposed', 'rejected', 'mnid:bb'),
    ];
    expect(summary(divergentMoves(events))).toEqual([
      { kind: 'decision', id: 'd-1', from: 'proposed', to: ['accepted', 'rejected'] },
    ]);
  });
});

describe('what is not a second move out of a state', () => {
  it('is not a birth, though a subject is born into a state more than once', () => {
    const events = [
      decision('d-1', null, 'proposed', 'mnid:aa'),
      decision('d-1', null, 'proposed', 'mnid:bb'),
      skill('s-1', null, 'proposed', 'mnid:aa'),
      skill('s-1', null, 'proposed', 'mnid:bb'),
    ];
    expect(divergentMoves(events)).toEqual([]);
  });

  it('is not a move of another subject out of the same state', () => {
    const events = [
      decision('d-1', 'proposed', 'accepted'),
      decision('d-2', 'proposed', 'rejected'),
      skill('s-1', 'proposed', 'reviewed'),
      skill('s-2', 'proposed', 'rejected'),
    ];
    expect(divergentMoves(events)).toEqual([]);
  });

  it('is not a decision and a skill that share an id and a state', () => {
    const events = [decision('x-1', 'proposed', 'accepted'), skill('x-1', 'proposed', 'reviewed')];
    expect(divergentMoves(events)).toEqual([]);
  });
});

describe('a task moved out of a state the record no longer had it in', () => {
  const born = task('t-1', null, 'DRAFT', 'create');
  const submit = task('t-1', 'DRAFT', 'READY', 'submit', 'mnid:aa');

  it('holds every stale move of one state in one report, led by the move that left it', () => {
    const cancel = task('t-1', 'DRAFT', 'CANCELED', 'cancel', 'mnid:bb');
    const again = task('t-1', 'DRAFT', 'CANCELED', 'cancel', 'mnid:cc');
    const found = divergentMoves([born, submit, cancel, again]);
    expect(summary(found)).toEqual([
      { kind: 'task', id: 't-1', from: 'DRAFT', to: ['READY', 'CANCELED', 'CANCELED'] },
    ]);
    expect(found[0]?.evidence).toEqual([submit, cancel, again]);
  });

  it('does not take for the move that left a state one that did not leave it', () => {
    // `cancel` is judged on a record that had the task in READY; it left nothing. A later move
    // out of DRAFT is stale against `submit`, the move that did leave DRAFT.
    const cancel = task('t-1', 'DRAFT', 'CANCELED', 'cancel', 'mnid:bb');
    const late = task('t-1', 'DRAFT', 'CANCELED', 'cancel', 'mnid:cc');
    const found = divergentMoves([born, submit, cancel, late]);
    expect(found).toHaveLength(1);
    expect(found[0]?.evidence).toEqual([submit, cancel, late]);
  });

  it('says nothing of the birth of a task, of the first move of a task never born, or of a stale move of no one', () => {
    const lone = task('t-2', 'DRAFT', 'READY', 'submit');
    const jump = task('t-3', 'DRAFT', 'READY', 'submit');
    const bornThree = task('t-3', null, 'DRAFT', 'create');
    const stray = task('t-3', 'IN_PROGRESS', 'DONE', 'cancel');
    expect(divergentMoves([lone, bornThree, stray, jump])).toEqual([]);
  });

  it('says nothing of an honest reopen, which leaves the state the task stood in', () => {
    const start = task('t-1', 'READY', 'IN_PROGRESS', 'start');
    const done = task('t-1', 'IN_PROGRESS', 'DONE', 'complete');
    const reopen = task('t-1', 'DONE', 'IN_PROGRESS', 'reopen');
    const again = task('t-1', 'IN_PROGRESS', 'DONE', 'complete');
    expect(
      divergentMoves([
        task('t-1', null, 'DRAFT', 'create'),
        task('t-1', 'DRAFT', 'READY', 'submit'),
        start,
        done,
        reopen,
        again,
      ]),
    ).toEqual([]);
  });

  it('keeps two tasks apart', () => {
    const events = [
      born,
      submit,
      task('t-1', 'DRAFT', 'CANCELED', 'cancel'),
      task('t-9', null, 'DRAFT', 'create'),
      task('t-9', 'DRAFT', 'READY', 'submit'),
      task('t-9', 'DRAFT', 'CANCELED', 'cancel'),
    ];
    expect(summary(divergentMoves(events)).map((m) => m.id)).toEqual(['t-1', 't-9']);
  });
});

describe('divergent moves are reported by kind, then entity, then state', () => {
  const move = (kind: DivergentMove['kind'], entityId: string, from: string): DivergentMove => ({
    kind,
    entityId,
    from,
    evidence: [],
    to: [],
  });
  const total = [
    move('decision', 'a', 'accepted'),
    move('decision', 'a', 'proposed'),
    move('decision', 'b', 'proposed'),
    move('skill', 'a', 'proposed'),
    move('skill', 'a', 'reviewed'),
    move('task', 'a', 'DRAFT'),
    move('task', 'b', 'DRAFT'),
    move('task', 'b', 'READY'),
  ];
  const ids = (moves: readonly DivergentMove[]) =>
    moves.map((m) => `${m.kind}/${m.entityId}/${m.from}`);

  it('puts a shuffle in the one order, and says the same of the reverse', () => {
    const shuffled = [3, 7, 0, 5, 2, 6, 1, 4].map((index) => total[index] as DivergentMove);
    expect(ids(sortDivergent(shuffled))).toEqual(ids(total));
    expect(ids(sortDivergent([...total].reverse()))).toEqual(ids(total));
  });

  it('sorts in place and returns the array it was given', () => {
    const given = [...total].reverse();
    expect(sortDivergent(given)).toBe(given);
    expect(ids(given)).toEqual(ids(total));
  });

  it('reports the kinds, entities and states of a record in that order', () => {
    const events = [
      task('t-1', null, 'DRAFT', 'create'),
      task('t-1', 'DRAFT', 'READY', 'submit'),
      task('t-1', 'DRAFT', 'CANCELED', 'cancel'),
      skill('s-2', 'proposed', 'reviewed', 'mnid:aa'),
      skill('s-2', 'proposed', 'rejected', 'mnid:bb'),
      skill('s-1', 'proposed', 'reviewed', 'mnid:aa'),
      skill('s-1', 'proposed', 'rejected', 'mnid:bb'),
      decision('d-2', 'proposed', 'accepted', 'mnid:aa'),
      decision('d-2', 'proposed', 'rejected', 'mnid:bb'),
    ];
    expect(summary(divergentMoves(events)).map((m) => `${m.kind}/${m.id}`)).toEqual([
      'decision/d-2',
      'skill/s-1',
      'skill/s-2',
      'task/t-1',
    ]);
  });
});
