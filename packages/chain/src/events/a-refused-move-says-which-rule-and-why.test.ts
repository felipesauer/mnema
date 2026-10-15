/**
 * A REFUSED MOVE NAMES ITS RULE AND SAYS WHY IN THE WORDS THE CENSUS PRINTS.
 *
 * The cases beside `workflow.test.ts` assert the rule alone. These assert the whole ruling —
 * rule and line — and each choice of the judgment that a ruling-by-rule leaves open: which half
 * of a birth is wrong, which half of a row is wrong, who a successor may be, and which writer's
 * sight excuses a `from`.
 */

import { describe, expect, it } from 'vitest';
import { decisionTransitioned, runEnded, taskTransitioned } from './build.js';
import { isMove, judgeMove, type MoveEvent, type MoveStanding } from './workflow.js';

const env = { at: '2026-07-21T00:00:00.000Z', who: 'mnid:aa', signerFp: 'fp-1', subject: 'd-1' };

function move(event: ReturnType<typeof decisionTransitioned>): MoveEvent {
  if (!isMove(event)) throw new Error(`${event.kind} is not a move`);
  return event;
}

interface Standing {
  now?: string | undefined;
  /** The state the writer saw; `null` is a writer whose sight holds nothing of the subject. */
  seen?: string | null | undefined;
  held?: boolean | undefined;
  born?: string[] | undefined;
}

/** What the reader knows; what it was not told throws when it is asked. */
function standing({ now, seen, held, born = [] }: Standing): MoveStanding {
  return {
    now,
    seen: () => {
      if (seen === undefined) throw new Error('seen was asked');
      return seen === null ? undefined : seen;
    },
    held: () => {
      if (held === undefined) throw new Error('held was asked');
      return held;
    },
    born: (id) => born.includes(id),
  };
}

const decision = (payload: Parameters<typeof decisionTransitioned>[1]) =>
  move(decisionTransitioned(env, payload));

describe('a birth is refused for the half of it that is wrong', () => {
  const create = { from: null, to: 'proposed', action: 'create' };

  it('refuses a second birth, in words', () => {
    expect(judgeMove(decision(create), standing({ now: 'proposed' }))).toEqual({
      rule: 'born-twice',
      detail: 'a move null → proposed by "create", a birth of a subject born already',
    });
  });

  it('refuses a birth by the wrong action into the right state', () => {
    expect(
      judgeMove(decision({ ...create, action: 'accept' }), standing({ now: undefined })),
    ).toEqual({
      rule: 'not-in-the-table',
      detail: 'a move null → proposed by "accept", where a birth is null → proposed by "create"',
    });
  });

  it('refuses a birth by the right action into the wrong state', () => {
    expect(
      judgeMove(decision({ ...create, to: 'accepted' }), standing({ now: undefined })),
    ).toEqual({
      rule: 'not-in-the-table',
      detail: 'a move null → accepted by "create", where a birth is null → proposed by "create"',
    });
  });

  it('names the birth of a task by its own first state', () => {
    const task = move(taskTransitioned(env, { from: null, to: 'READY', action: 'create' }));
    expect(judgeMove(task, standing({ now: undefined }))).toEqual({
      rule: 'not-in-the-table',
      detail: 'a move null → READY by "create", where a birth is null → DRAFT by "create"',
    });
  });

  it('refuses a birth that names a successor, since a birth takes none', () => {
    expect(
      judgeMove(decision({ ...create, by: 'd-2' }), standing({ now: undefined, born: ['d-2'] })),
    ).toEqual({
      rule: 'successor',
      detail: 'a move null → proposed by "create" that names a successor it does not take',
    });
  });
});

describe('a move is a row of the table, whole', () => {
  const accept = { from: 'proposed', to: 'accepted', action: 'accept', fields: { note: 'n' } };

  it('refuses a move of a subject with no birth, in words', () => {
    expect(judgeMove(decision(accept), standing({ now: undefined }))).toEqual({
      rule: 'not-born',
      detail: 'a move proposed → accepted by "accept" of a subject with no birth before it',
    });
  });

  it('refuses an action the state does not have, though the state it reaches is a row of another', () => {
    expect(
      judgeMove(decision({ ...accept, action: 'approve' }), standing({ now: 'proposed' })),
    ).toEqual({
      rule: 'not-in-the-table',
      detail: 'a move proposed → accepted by "approve", which the workflow does not hold',
    });
  });

  it('refuses the right action into the wrong state', () => {
    expect(
      judgeMove(decision({ ...accept, to: 'rejected' }), standing({ now: 'proposed' })),
    ).toEqual({
      rule: 'not-in-the-table',
      detail: 'a move proposed → rejected by "accept", which the workflow does not hold',
    });
  });

  it('names the proof a row requires and the move lacks', () => {
    const { fields: _fields, ...bare } = accept;
    expect(judgeMove(decision(bare), standing({ now: 'proposed' }))).toEqual({
      rule: 'proof-missing',
      detail: 'a move proposed → accepted by "accept" without the note it requires',
    });
  });

  it('admits a row that requires nothing, with or without fields', () => {
    const submit = { from: 'DRAFT', to: 'READY', action: 'submit' };
    expect(
      judgeMove(move(taskTransitioned(env, submit)), standing({ now: 'DRAFT' })),
    ).toBeUndefined();
  });

  it('writes a value out of the record on one line', () => {
    expect(
      judgeMove(decision({ ...accept, action: 'ac\ncept' }), standing({ now: 'proposed' })),
    ).toEqual({
      rule: 'not-in-the-table',
      detail: 'a move proposed → accepted by "ac cept", which the workflow does not hold',
    });
  });
});

describe('a successor is a decision the record holds, other than the subject', () => {
  const supersede = (by?: string) =>
    decision({
      from: 'accepted',
      to: 'superseded',
      action: 'supersede',
      ...(by === undefined ? {} : { by }),
      fields: { reason: 'r' },
    });

  it('says a supersede that names none names none', () => {
    expect(judgeMove(supersede(), standing({ now: 'accepted' }))).toEqual({
      rule: 'successor',
      detail: 'a move accepted → superseded by "supersede" that names no successor',
    });
  });

  it('says a supersede that names its own subject names its own subject', () => {
    expect(judgeMove(supersede('d-1'), standing({ now: 'accepted', born: ['d-1'] }))).toEqual({
      rule: 'successor',
      detail: 'a move accepted → superseded by "supersede" that names its own subject as successor',
    });
  });

  it('says a successor with no birth on the record has none', () => {
    expect(judgeMove(supersede('d-9'), standing({ now: 'accepted', born: ['d-2'] }))).toEqual({
      rule: 'successor',
      detail:
        'a move accepted → superseded by "supersede" naming a successor d-9 the record holds no birth of',
    });
  });

  it('admits a successor the record holds, and says what a move that takes none does when it names one', () => {
    expect(
      judgeMove(supersede('d-2'), standing({ now: 'accepted', born: ['d-2'] })),
    ).toBeUndefined();
    const named = decision({
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      by: 'd-2',
      fields: { note: 'n' },
    });
    expect(judgeMove(named, standing({ now: 'proposed', born: ['d-2'] }))).toEqual({
      rule: 'successor',
      detail: 'a move proposed → accepted by "accept" that names a successor it does not take',
    });
  });
});

describe('a move is excused by the state the subject is in, or the one its writer saw', () => {
  const reject = decision({
    from: 'proposed',
    to: 'rejected',
    action: 'reject',
    fields: { note: 'n' },
  });

  it('admits the state the subject is in without asking what was seen', () => {
    expect(judgeMove(reject, standing({ now: 'proposed' }))).toBeUndefined();
  });

  it('admits the state the writer saw, when the subject moved on elsewhere', () => {
    expect(judgeMove(reject, standing({ now: 'accepted', seen: 'proposed' }))).toBeUndefined();
  });

  it('refuses a state neither saw, and says what each saw', () => {
    expect(judgeMove(reject, standing({ now: 'accepted', seen: 'rejected', held: true }))).toEqual({
      rule: 'not-the-state-seen',
      detail:
        'a move proposed → rejected by "reject" of a subject that was accepted there, and rejected to the one that wrote it',
    });
  });

  it('holds a writer that saw nothing to a state the subject had been in', () => {
    expect(
      judgeMove(reject, standing({ now: 'accepted', seen: null, held: true })),
    ).toBeUndefined();
  });

  it('refuses a writer that saw nothing, from a state the subject never was in, and says it was not born to it', () => {
    expect(judgeMove(reject, standing({ now: 'accepted', seen: null, held: false }))).toEqual({
      rule: 'not-the-state-seen',
      detail:
        'a move proposed → rejected by "reject" of a subject that was accepted there, and not born to the one that wrote it',
    });
  });
});

describe('the end of a run is judged by whether the run is open', () => {
  const end = move(runEnded({ ...env, subject: 'r-1' }, {}));

  it('says a run never started has no start', () => {
    expect(judgeMove(end, standing({ now: undefined }))).toEqual({
      rule: 'not-born',
      detail: 'the end of a run with no start before it',
    });
  });

  it('says a run that had ended, for a writer that saw it end, ended twice', () => {
    expect(judgeMove(end, standing({ now: 'ended', seen: 'ended' }))).toEqual({
      rule: 'ended-twice',
      detail: 'the end of a run that had ended already',
    });
  });

  it('admits the end of a run its writer saw open, though it has ended elsewhere', () => {
    expect(judgeMove(end, standing({ now: 'ended', seen: 'open' }))).toBeUndefined();
  });

  it('admits the end of an open run without asking what was seen', () => {
    expect(judgeMove(end, standing({ now: 'open' }))).toBeUndefined();
  });
});
