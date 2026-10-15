import { describe, expect, it } from 'vitest';
import {
  decisionBirth,
  decisionTransitioned,
  memoryCaptured,
  runEnded,
  runStarted,
} from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import type { CitationHeld } from './causal-order.js';
import { illegalMoves, type PlacedEvent } from './moves.js';

const env = (at: number, subject = 'd-1') => ({
  at: new Date(Date.UTC(2026, 6, 21) + at * 1000).toISOString(),
  who: 'mnid:aa',
  signerFp: 'fp-1',
  subject,
});

const birth = (subject = 'd-1'): CatalogEvent[] =>
  decisionBirth(env(0, subject), { title: 't', rationale: 'r', adr: 'ADR-1', initial: 'proposed' });
const accept = (at: number) =>
  decisionTransitioned(env(at), {
    from: 'proposed',
    to: 'accepted',
    action: 'accept',
    fields: { note: 'n' },
  });
const reject = (at: number, from = 'proposed') =>
  decisionTransitioned(env(at), { from, to: 'rejected', action: 'reject', fields: { note: 'n' } });

/** An order, written as (tail, event) in the merged order; positions are counted per tail. */
function placed(...steps: (readonly [number, CatalogEvent])[]): PlacedEvent[] {
  const next = new Map<number, number>();
  return steps.map(([tail, event]) => {
    const position = next.get(tail) ?? 0;
    next.set(tail, position + 1);
    return { event, tail, position };
  });
}

const cite = (tail: number, position: number, citedTail: number, citedPosition: number) =>
  ({ tail, position, citedTail, citedPosition }) satisfies CitationHeld;

/** The rule of each illegal move, by the index of the move in the order. */
const rules = (order: PlacedEvent[], held: CitationHeld[] = []) =>
  [...illegalMoves(order, held)].map(([index, move]) => [index, move.rule]);

describe('a move is judged against the moves before it that were legal', () => {
  it('names the second move out of `proposed` on one tail, which its writer had seen leave', () => {
    const [recorded, born] = birth() as [CatalogEvent, CatalogEvent];
    const order = placed([0, recorded], [0, born], [0, reject(1)], [0, accept(2)]);
    expect(rules(order)).toEqual([[3, 'not-the-state-seen']]);
  });

  it('applies nothing an illegal move did: a move from the state it claimed is judged as never reached', () => {
    const [recorded, born] = birth() as [CatalogEvent, CatalogEvent];
    const forged = decisionTransitioned(env(2), {
      from: 'rejected',
      to: 'accepted',
      action: 'accept',
    });
    const supersede = decisionTransitioned(env(3), {
      from: 'accepted',
      to: 'superseded',
      action: 'supersede',
      by: 'd-2',
      fields: { reason: 'r' },
    });
    const [other, otherBorn] = birth('d-2') as [CatalogEvent, CatalogEvent];
    const order = placed(
      [0, recorded],
      [0, born],
      [0, other],
      [0, otherBorn],
      [0, reject(1)],
      [0, forged],
      [0, supersede],
    );
    expect(rules(order)).toEqual([
      [5, 'not-in-the-table'],
      [6, 'not-the-state-seen'],
    ]);
  });
});

describe('across tails, a writer is judged by what it cites', () => {
  it('keeps two machines that did not see each other a divergence: both moves apply', () => {
    // Tail 1 read the birth (it cites position 1 of tail 0) and not the accept.
    const [recorded, born] = birth() as [CatalogEvent, CatalogEvent];
    const order = placed(
      [0, recorded],
      [0, born],
      [1, memoryCaptured(env(1, 'm-1'), { content: 'read it' })],
      [0, accept(2)],
      [1, reject(3)],
    );
    expect(rules(order, [cite(1, 0, 0, 1)])).toEqual([]);
  });

  it('names the move of a writer that cited the move it then contradicts', () => {
    const [recorded, born] = birth() as [CatalogEvent, CatalogEvent];
    const order = placed(
      [0, recorded],
      [0, born],
      [0, accept(1)],
      [1, memoryCaptured(env(2, 'm-1'), { content: 'read it' })],
      [1, reject(3)],
    );
    expect(rules(order, [cite(1, 0, 0, 2)])).toEqual([[4, 'not-the-state-seen']]);
  });

  it('reads a writer that cited nothing in the merged order, as a record from before citations is', () => {
    const [recorded, born] = birth() as [CatalogEvent, CatalogEvent];
    const fromAccepted = decisionTransitioned(env(3), {
      from: 'accepted',
      to: 'superseded',
      action: 'supersede',
      by: 'd-2',
      fields: { reason: 'r' },
    });
    const [other, otherBorn] = birth('d-2') as [CatalogEvent, CatalogEvent];
    const order = placed(
      [0, recorded],
      [0, born],
      [0, other],
      [0, otherBorn],
      [0, accept(1)],
      [1, fromAccepted],
      [1, reject(4)],
    );
    // The supersede left the state the record had it in, and stands; the reject left one the
    // decision was no longer in, and its writer, citing nothing, saw no birth at all.
    expect(rules(order)).toEqual([[6, 'not-the-state-seen']]);
  });
});

describe('the rest of the rule', () => {
  it('names a successor the record holds no birth of, and a move of a subject never born', () => {
    const [recorded, born] = birth() as [CatalogEvent, CatalogEvent];
    const phantom = decisionTransitioned(env(1), {
      from: 'proposed',
      to: 'superseded',
      action: 'supersede',
      by: 'd-9',
      fields: { reason: 'r' },
    });
    const order = placed([0, recorded], [0, born], [0, phantom], [0, reject(2, 'proposed')]);
    expect(rules(order)).toEqual([[2, 'successor']]);
    expect(rules(placed([0, accept(1)]))).toEqual([[0, 'not-born']]);
  });

  it('names the second end of a run', () => {
    const run = (at: number) => env(at, 'r-1');
    const order = placed(
      [0, runStarted(run(0), { agent: 'a' })],
      [0, runEnded(run(1))],
      [0, runEnded(run(2))],
    );
    expect(rules(order)).toEqual([[2, 'ended-twice']]);
  });
});
