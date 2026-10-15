import { describe, expect, it } from 'vitest';
import {
  decisionTransitioned as decisionBuilt,
  runEnded as runBuilt,
  skillTransitioned as skillBuilt,
  taskTransitioned as taskBuilt,
} from './build.js';
import type { CatalogEvent } from './catalog.js';
import {
  isMove,
  judgeMove,
  type MoveEvent,
  type MoveStanding,
  RUN_ENDED,
  RUN_OPEN,
  WORKFLOWS,
} from './workflow.js';

/** The builders return the catalog's union; every event here is a move. */
function move(event: CatalogEvent): MoveEvent {
  if (!isMove(event)) throw new Error(`${event.kind} is not a move`);
  return event;
}
const decisionTransitioned = (...a: Parameters<typeof decisionBuilt>) => move(decisionBuilt(...a));
const taskTransitioned = (...a: Parameters<typeof taskBuilt>) => move(taskBuilt(...a));
const skillTransitioned = (...a: Parameters<typeof skillBuilt>) => move(skillBuilt(...a));
const runEnded = (...a: Parameters<typeof runBuilt>) => move(runBuilt(...a));

const env = { at: '2026-07-21T00:00:00.000Z', who: 'mnid:aa', signerFp: 'fp-1', subject: 'd-1' };

/** A subject in `now`, whose writer saw `seen`; asking for `seen` when it is not given throws. */
function standing(now: string | undefined, seen?: string, born: string[] = []): MoveStanding {
  return {
    now,
    seen: () => {
      if (seen === undefined) throw new Error('seen was asked of a move the state admits');
      return seen;
    },
    born: (id) => born.includes(id),
  };
}

const accept = (from: string | null, to = 'accepted', fields: { note?: string } = { note: 'n' }) =>
  decisionTransitioned(env, { from, to, action: 'accept', fields });

describe('a move is judged by the table of its workflow', () => {
  it('admits a row of the table, from the state the subject is in, without asking what was seen', () => {
    expect(judgeMove(accept('proposed'), standing('proposed'))).toBeUndefined();
    expect(
      judgeMove(
        taskTransitioned(env, {
          from: 'DONE',
          to: 'IN_PROGRESS',
          action: 'reopen',
          fields: { reason: 'r' },
        }),
        standing('DONE'),
      ),
    ).toBeUndefined();
    expect(
      judgeMove(
        skillTransitioned(env, {
          from: 'adopted',
          to: 'deprecated',
          action: 'deprecate',
          fields: { reason: 'r' },
        }),
        standing('adopted'),
      ),
    ).toBeUndefined();
  });

  it('refuses rejected → accepted, the move written by hand that every reader used to serve', () => {
    expect(judgeMove(accept('rejected'), standing('rejected'))).toMatchObject({
      rule: 'not-in-the-table',
    });
  });

  it('refuses a state that is not one of the workflow, and an action it does not have', () => {
    const banana = decisionTransitioned(env, {
      from: 'rejected',
      to: 'banana',
      action: 'teleport',
    });
    expect(judgeMove(banana, standing('rejected'))).toMatchObject({ rule: 'not-in-the-table' });
    // A row's `from` and action, with another `to`: the row decides where the move lands.
    expect(judgeMove(accept('proposed', 'rejected'), standing('proposed'))).toMatchObject({
      rule: 'not-in-the-table',
    });
  });

  it('refuses a move without the proof its row requires', () => {
    expect(judgeMove(accept('proposed', 'accepted', {}), standing('proposed'))).toEqual({
      rule: 'proof-missing',
      detail: 'a move proposed → accepted by "accept" without the note it requires',
    });
  });

  it('refuses a move of a subject with no birth before it', () => {
    expect(judgeMove(accept('proposed'), standing(undefined))).toMatchObject({ rule: 'not-born' });
  });
});

describe('a move is judged from the state it left', () => {
  it('refuses a `from` the subject had already left, on the tail that left it', () => {
    // The cache edited back to `proposed` after a reject on the same machine: the record has the
    // subject rejected, and so did the writer, whose own tail holds the reject.
    expect(judgeMove(accept('proposed'), standing('rejected', 'rejected'))).toEqual({
      rule: 'not-the-state-seen',
      detail:
        'a move proposed → accepted by "accept" of a subject that was rejected there, ' +
        'and rejected to the one that wrote it',
    });
  });

  it('admits a `from` its writer saw when the record moved on elsewhere: a divergence, not an illegal move', () => {
    // Accepted on one machine, rejected on another that had not seen the accept.
    const reject = decisionTransitioned(env, {
      from: 'proposed',
      to: 'rejected',
      action: 'reject',
      fields: { note: 'n' },
    });
    expect(judgeMove(reject, standing('accepted', 'proposed'))).toBeUndefined();
  });
});

describe('a birth happens once, and lands where the workflow begins', () => {
  const birth = (to: string) => decisionTransitioned(env, { from: null, to, action: 'create' });

  it('admits the first birth and refuses a second', () => {
    expect(judgeMove(birth('proposed'), standing(undefined))).toBeUndefined();
    expect(judgeMove(birth('proposed'), standing('proposed'))).toMatchObject({
      rule: 'born-twice',
    });
  });

  it('refuses a birth into any state but the first', () => {
    expect(judgeMove(birth('accepted'), standing(undefined))).toMatchObject({
      rule: 'not-in-the-table',
    });
    expect(
      judgeMove(
        taskTransitioned(env, { from: null, to: 'DONE', action: 'create' }),
        standing(undefined),
      ),
    ).toMatchObject({ rule: 'not-in-the-table' });
  });
});

describe('a supersede names a successor the record holds', () => {
  const supersede = (by: string | undefined) =>
    decisionTransitioned(env, {
      from: 'accepted',
      to: 'superseded',
      action: 'supersede',
      ...(by !== undefined ? { by } : {}),
      fields: { reason: 'r' },
    });

  it('admits a successor whose birth the record holds', () => {
    expect(judgeMove(supersede('d-2'), standing('accepted', undefined, ['d-2']))).toBeUndefined();
  });

  it('refuses a successor with no birth, none at all, and the subject itself', () => {
    expect(judgeMove(supersede('d-9'), standing('accepted', undefined, ['d-2']))).toMatchObject({
      rule: 'successor',
    });
    expect(judgeMove(supersede(undefined), standing('accepted'))).toMatchObject({
      rule: 'successor',
    });
    expect(judgeMove(supersede('d-1'), standing('accepted', undefined, ['d-1']))).toMatchObject({
      rule: 'successor',
    });
  });

  it('refuses a successor on a move that takes none', () => {
    const named = decisionTransitioned(env, {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      by: 'd-2',
      fields: { note: 'n' },
    });
    expect(judgeMove(named, standing('proposed', undefined, ['d-2']))).toMatchObject({
      rule: 'successor',
    });
  });
});

describe('a run ends once', () => {
  const end = runEnded({ ...env, subject: 'r-1' }, {});

  it('admits the end of an open run', () => {
    expect(judgeMove(end, standing(RUN_OPEN))).toBeUndefined();
  });

  it('refuses a second end its writer had seen, and the end of a run never started', () => {
    expect(judgeMove(end, standing(RUN_ENDED, RUN_ENDED))).toMatchObject({ rule: 'ended-twice' });
    expect(judgeMove(end, standing(undefined))).toMatchObject({ rule: 'not-born' });
  });
});

describe('the tables are the workflows', () => {
  it('holds one row per (from, action), and only states of its own workflow', () => {
    for (const machine of Object.values(WORKFLOWS)) {
      const states: readonly string[] = machine.states;
      const pairs = machine.moves.map((move) => `${move.from}\u0000${move.action}`);
      expect(new Set(pairs).size).toBe(pairs.length);
      for (const move of machine.moves) {
        expect(states).toContain(move.from);
        expect(states).toContain(move.to);
      }
      expect(states).toContain(machine.birth.to);
    }
  });
});
