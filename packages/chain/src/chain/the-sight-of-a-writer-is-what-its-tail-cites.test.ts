/**
 * A WRITER SAW WHAT ITS TAIL HOLDS BEFORE A MOVE AND WHAT ITS TAIL CITES, AND NOTHING ELSE:
 * and a successor is the birth of a DECISION, not any subject the record has heard of.
 *
 * The cases beside `moves.test.ts` pin the rulings. These pin the edges of the sight: that the
 * birth of a subject is part of what a writer saw, that a tail of its own position count is not
 * a sight of another tail, that a citation of one tail is no sight of another, and which events
 * count as the birth a successor names.
 */

import { describe, expect, it } from 'vitest';
import {
  decisionBirth,
  decisionTransitioned,
  memoryCaptured,
  runEnded,
  runStarted,
  taskBirth,
} from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import type { CitationHeld } from './causal-order.js';
import { illegalMoves, type PlacedEvent, sightOf } from './moves.js';

const env = (at: number, subject = 'd-1') => ({
  at: new Date(Date.UTC(2026, 6, 21) + at * 1000).toISOString(),
  who: 'mnid:aa',
  signerFp: 'fp-1',
  subject,
});

const birth = (subject: string): [CatalogEvent, CatalogEvent] =>
  decisionBirth(env(0, subject), {
    title: 't',
    rationale: 'r',
    adr: 'ADR-1',
    initial: 'proposed',
  }) as [CatalogEvent, CatalogEvent];

const accept = (at: number, subject = 'd-1') =>
  decisionTransitioned(env(at, subject), {
    from: 'proposed',
    to: 'accepted',
    action: 'accept',
    fields: { note: 'n' },
  });

const supersede = (at: number, by: string, from = 'accepted') =>
  decisionTransitioned(env(at), {
    from,
    to: 'superseded',
    action: 'supersede',
    by,
    fields: { reason: 'r' },
  });

const note = (at: number) => memoryCaptured(env(at, `m-${at}`), { content: 'read it' });

function placed(...steps: (readonly [number, CatalogEvent])[]): PlacedEvent[] {
  const next = new Map<number, number>();
  return steps.map(([tail, event]) => {
    const position = next.get(tail) ?? 0;
    next.set(tail, position + 1);
    return { event, tail, position };
  });
}

const rules = (order: PlacedEvent[], held: CitationHeld[] = []) =>
  [...illegalMoves(order, held)].map(([index, move]) => [index, move.rule]);

describe('a successor is the birth of a decision', () => {
  it('is not the birth of a task, though the record holds one under that name', () => {
    const [recorded, born] = birth('d-1');
    const [created, taskBorn] = taskBirth(env(1, 'd-2'), { title: 't', initial: 'DRAFT' });
    const order = placed(
      [0, recorded],
      [0, born],
      [0, created as CatalogEvent],
      [0, taskBorn as CatalogEvent],
      [0, supersede(2, 'd-2', 'proposed')],
    );
    expect(rules(order)).toEqual([[4, 'successor']]);
  });

  it('is not a decision that was moved and never born', () => {
    const [recorded, born] = birth('d-1');
    const order = placed(
      [0, recorded],
      [0, born],
      [0, accept(1, 'd-2')],
      [0, supersede(2, 'd-2', 'proposed')],
    );
    expect(rules(order)).toEqual([
      [2, 'not-born'],
      [3, 'successor'],
    ]);
  });

  it('is the birth the record holds, when the order is the whole record', () => {
    const [recorded, born] = birth('d-1');
    const [other, otherBorn] = birth('d-2');
    const order = placed(
      [0, recorded],
      [0, born],
      [0, other],
      [0, otherBorn],
      [0, supersede(2, 'd-2', 'proposed')],
    );
    expect(rules(order)).toEqual([]);
  });

  it('is the birth the reader says it holds, when the reader hands its own', () => {
    const [recorded, born] = birth('d-1');
    const order = placed([0, recorded], [0, born], [0, supersede(2, 'd-7', 'proposed')]);
    expect([...illegalMoves(order, [], (id) => id === 'd-7')]).toEqual([]);
    expect([...illegalMoves(order, [], () => false)].map(([, move]) => move.rule)).toEqual([
      'successor',
    ]);
  });
});

describe('a subject is a subject of its own workflow', () => {
  it('lets a run and a decision share an id without sharing a state', () => {
    const run = (at: number) => env(at, 'x-1');
    const [recorded, born] = birth('x-1');
    const order = placed(
      [0, runStarted(run(0), { agent: 'a' })],
      [0, recorded],
      [0, born],
      [0, accept(2, 'x-1')],
      [0, runEnded(run(3))],
    );
    expect(rules(order)).toEqual([]);
  });
});

describe('a writer saw the birth of its subject, and only what its tail holds or cites', () => {
  // Tail 0 moves d-1 through proposed, accepted and superseded. Tail 1 moves it from `accepted`.
  const [recorded, born] = birth('d-1');
  const [other, otherBorn] = birth('d-2');
  const tail0 = [
    [0, recorded],
    [0, other],
    [0, born],
    [0, otherBorn],
    [0, accept(1)],
    [0, supersede(2, 'd-2')],
  ] as const;
  // The birth of d-1 is the 3rd entry of tail 0 (position 2).
  const readsTheBirth: CitationHeld = { tail: 1, position: 0, citedTail: 0, citedPosition: 2 };
  const aWriter = (...fillers: number[]) => [
    ...fillers.map((at) => [1, note(at)] as const),
    [1, supersede(9, 'd-2')] as const,
  ];

  it('names a move from a state the writer had not reached when it read only the birth', () => {
    const order = placed(...tail0, ...aWriter(5));
    expect(rules(order, [readsTheBirth])).toEqual([[7, 'not-the-state-seen']]);
  });

  it('keeps that move a divergence when the writer read nothing, as the state had been reached', () => {
    // 4 entries of its own before the move: a count of positions is no sight of tail 0.
    const order = placed(...tail0, ...aWriter(5, 6, 7, 8));
    expect(rules(order)).toEqual([]);
  });

  it('keeps that move a divergence when the writer cited another tail, not tail 0', () => {
    const order = placed(...tail0, [2, note(3)], ...aWriter(5));
    const citesTail2: CitationHeld = { tail: 1, position: 0, citedTail: 2, citedPosition: 99 };
    expect(rules(order, [citesTail2])).toEqual([]);
  });
});

describe('the sight of a writer, asked of two entries', () => {
  const cites: CitationHeld[] = [{ tail: 1, position: 2, citedTail: 0, citedPosition: 5 }];
  const saw = sightOf(cites);

  it('is the entries before it, on its own tail only', () => {
    expect(saw({ tail: 0, position: 3 }, { tail: 0, position: 2 })).toBe(true);
    expect(saw({ tail: 0, position: 3 }, { tail: 0, position: 3 })).toBe(false);
    expect(saw({ tail: 0, position: 3 }, { tail: 0, position: 4 })).toBe(false);
  });

  it('is, on another tail, the entries up to what a citation at or before it names', () => {
    expect(saw({ tail: 1, position: 2 }, { tail: 0, position: 5 })).toBe(true);
    expect(saw({ tail: 1, position: 2 }, { tail: 0, position: 6 })).toBe(false);
    expect(saw({ tail: 1, position: 1 }, { tail: 0, position: 0 })).toBe(false);
    expect(saw({ tail: 1, position: 4 }, { tail: 0, position: 0 })).toBe(true);
    expect(saw({ tail: 1, position: 4 }, { tail: 2, position: 0 })).toBe(false);
    expect(saw({ tail: 1, position: 4 }, { tail: 1, position: 3 })).toBe(true);
  });

  it('is nothing of another tail for a tail that cites nothing', () => {
    expect(saw({ tail: 2, position: 9 }, { tail: 0, position: 0 })).toBe(false);
    expect(saw({ tail: 2, position: 9 }, { tail: 2, position: 8 })).toBe(true);
  });
});
