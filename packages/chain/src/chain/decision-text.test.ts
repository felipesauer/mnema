/**
 * Which writing of a decision is its text (FORMAT.md section 6.8): `decisionTexts`, over a merged
 * order and the citations it honoured.
 *
 * Every expected index here is written out by hand from the order the case lays down, never
 * computed the way the function computes it.
 */

import { describe, expect, it } from 'vitest';
import { decisionRecorded, decisionTransitioned } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import type { CitationHeld } from './causal-order.js';
import { decisionTexts } from './decision-text.js';
import { illegalMoves, type PlacedEvent } from './moves.js';

const env = (at: number, subject = 'd-1') => ({
  at: new Date(Date.UTC(2026, 9, 27) + at * 1000).toISOString(),
  who: 'mnid:aa',
  signerFp: 'fp-1',
  subject,
});

const writing = (at: number, title: string, subject = 'd-1') =>
  decisionRecorded(env(at, subject), { title, rationale: 'r', adr: 'ADR-1' });
const born = (at: number, subject = 'd-1') =>
  decisionTransitioned(env(at, subject), { from: null, to: 'proposed', action: 'create' });
const accept = (at: number, fields: Record<string, string> = { note: 'n' }) =>
  decisionTransitioned(env(at), { from: 'proposed', to: 'accepted', action: 'accept', fields });

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

/** The index of the writing each decision is the text of, as the readers judge the order. */
const texts = (order: PlacedEvent[], held: CitationHeld[] = []) =>
  Object.fromEntries(decisionTexts(order, held, illegalMoves(order, held)));

describe('a decision is the text its first judgment saw', () => {
  it('is the first writing in the order while nothing has judged it', () => {
    // Tail 1 wrote "forged" at a clock before tail 0's writing: first in the order, and pending.
    const order = placed([1, writing(0, 'forged')], [0, writing(1, 'honest')], [0, born(2)]);
    expect(texts(order)).toEqual({ 'd-1': 0 });
  });

  it('is the writing the accept saw, when the first in the order is one its writer had not read', () => {
    // Tail 0: honest writing, birth, accept. Tail 1: a writing dated before all of it, which
    // tail 0 never cited, so the accept was made on the honest text.
    const order = placed(
      [1, writing(0, 'forged')],
      [0, writing(1, 'honest')],
      [0, born(2)],
      [0, accept(3)],
    );
    expect(texts(order)).toEqual({ 'd-1': 1 });
  });

  it('is the first writing the accept saw, when its writer had read both', () => {
    // Tail 0 cites tail 1's writing at its own birth, so the accept saw both, and the first in
    // the order is the one it was shown.
    const order = placed(
      [1, writing(0, 'forged')],
      [0, writing(1, 'honest')],
      [0, born(2)],
      [0, accept(3)],
    );
    expect(texts(order, [cite(0, 1, 1, 0)])).toEqual({ 'd-1': 0 });
  });

  it('does not count a citation of a tail made below the writing as having read it', () => {
    // Tail 0 cited tail 1 at position 0, its founding; the writing came after, at position 1.
    const founded = writing(0, 'unrelated', 'd-other');
    const order = placed(
      [1, founded],
      [1, writing(0, 'forged')],
      [0, writing(1, 'honest')],
      [0, born(2)],
      [0, accept(3)],
    );
    expect(texts(order, [cite(0, 0, 1, 0)])).toEqual({ 'd-other': 0, 'd-1': 2 });
  });

  it('is bound by the first judgment that is applied: a move the workflow refuses binds nothing', () => {
    // Tail 1 wrote a text and an accept with no note, which the workflow does not apply, both
    // dated before tail 0's accept.
    const order = placed(
      [1, writing(0, 'forged')],
      [0, writing(1, 'honest')],
      [0, born(2)],
      [1, accept(2, {})],
      [0, accept(3)],
    );
    expect(texts(order)).toEqual({ 'd-1': 1 });
  });

  it('keeps the first writing in the order when the judgment saw none of them', () => {
    // An accept on a tail that holds no writing and cites nothing: what a record written before
    // citations reads as.
    const order = placed(
      [1, writing(0, 'first')],
      [0, writing(1, 'second')],
      [0, born(2)],
      [2, accept(3)],
    );
    expect(texts(order)).toEqual({ 'd-1': 0 });
  });

  it('is not moved by a writing that comes after the judgment', () => {
    const order = placed(
      [0, writing(1, 'honest')],
      [0, born(2)],
      [0, accept(3)],
      [1, writing(4, 'late')],
    );
    expect(texts(order)).toEqual({ 'd-1': 0 });
  });
});
