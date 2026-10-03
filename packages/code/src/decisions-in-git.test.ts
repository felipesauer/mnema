/**
 * How a word or a trailer value names a decision: an id exactly, a label only when one decision
 * carries it.
 */

import { describe, expect, it } from 'vitest';
import { cites, type DecisionFacts, nameOf } from './decisions-in-git.js';

/** A decision with only what naming needs. */
function facts(id: string, adr: string): DecisionFacts {
  return {
    id,
    adr,
    title: id,
    state: 'accepted',
    settledAt: '2026-01-01T00:00:00Z',
    addresses: [],
  };
}

const ONE = facts('id-one', 'ADR-1');
const TWO = facts('id-two', 'ADR-2');
const TWIN_A = facts('id-twin-a', 'ADR-3');
const TWIN_B = facts('id-twin-b', 'ADR-3');
const ALL = [ONE, TWO, TWIN_A, TWIN_B];

describe('naming a decision', () => {
  it('takes an id exactly, and a label in any case when one decision carries it', () => {
    expect(nameOf(ALL, 'id-one')).toEqual({ kind: 'decision', decision: ONE });
    expect(nameOf(ALL, ' adr-2 ')).toEqual({ kind: 'decision', decision: TWO });
  });

  it('names no decision by a label two carry, and says which two', () => {
    expect(nameOf(ALL, 'ADR-3')).toEqual({ kind: 'ambiguous', ids: ['id-twin-a', 'id-twin-b'] });
    // The id still names exactly one of them.
    expect(nameOf(ALL, 'id-twin-b')).toEqual({ kind: 'decision', decision: TWIN_B });
  });

  it('names nothing for what is no id and no label', () => {
    expect(nameOf(ALL, 'ADR-9')).toEqual({ kind: 'none' });
    expect(nameOf(ALL, 'keep it small')).toEqual({ kind: 'none' });
  });

  it('lets a trailer cite a decision by its id or its unshared label and no other', () => {
    expect(cites(ALL, ONE, 'ADR-1')).toBe(true);
    expect(cites(ALL, ONE, 'id-one')).toBe(true);
    expect(cites(ALL, ONE, 'ADR-2')).toBe(false);
    // A label two carry cites neither of them.
    expect(cites(ALL, TWIN_A, 'ADR-3')).toBe(false);
    expect(cites(ALL, TWIN_A, 'id-twin-a')).toBe(true);
  });
});
