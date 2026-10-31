/**
 * The keys a tail introduces, from `tail-keys.ts`: which a cut would lose, and whether it breaks
 * them or only strands them. The entries are written by hand with the fields the rule reads (kind
 * and payload), which are the fields the product's own events carry for these kinds.
 */

import { describe, expect, it } from 'vitest';
import type { Entry } from './entry.js';
import { keysATailHolds } from './tail-keys.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);

const TAIL_A = `${A}-one`;
const TAIL_C = `${C}-one`;

/** An entry the rule can read. The rest of an entry is not read by it. */
function entry(kind: string, payload: Record<string, string>): Entry {
  return { event: { kind, payload } } as unknown as Entry;
}

const founded = (fp: string) => entry('identity.founded', { foundingFp: fp });
const enrolled = (fp: string) => entry('key.enrolled', { newFp: fp, reverseSig: 'x' });
const waiver = (tail: string) => entry('tail.pruned', { tail });

function record(tails: Record<string, Entry[]>): Map<string, readonly Entry[]> {
  return new Map(Object.entries(tails));
}

describe('keys a tail introduces', () => {
  it('names a founded key and an enrolled one, in the order the tail wrote them', () => {
    const held = keysATailHolds(record({ [TAIL_A]: [founded(A), enrolled(B)] }), TAIL_A);
    expect(held.map((key) => [key.fp, key.how])).toEqual([
      [A, 'founded'],
      [B, 'enrolled'],
    ]);
  });

  it('names an agent key and a checker key by their roles', () => {
    const held = keysATailHolds(
      record({
        [TAIL_A]: [
          entry('agent.enrolled', { agentFp: D, name: 'bot', reverseSig: 'x' }),
          entry('checker.enrolled', { checkerFp: E, reverseSig: 'x' }),
        ],
      }),
      TAIL_A,
    );
    expect(held.map((key) => [key.fp, key.how])).toEqual([
      [D, 'agent'],
      [E, 'checker'],
    ]);
  });

  it('says a key stranded when nothing of it stays, and broken when a tail of it stays', () => {
    const entries = record({
      [TAIL_A]: [founded(A), enrolled(C)],
      [TAIL_C]: [entry('decision.recorded', {})],
    });
    const held = keysATailHolds(entries, TAIL_A);
    expect(held.map((key) => [key.fp, key.breaks])).toEqual([
      [A, false],
      [C, true],
    ]);
  });

  it('counts a tail with a waiver as cut, and the writer tail as staying', () => {
    const entries = record({
      [TAIL_A]: [founded(A), enrolled(C)],
      [TAIL_C]: [entry('decision.recorded', {})],
      [`${B}-one`]: [waiver(TAIL_C)],
    });
    expect(keysATailHolds(entries, TAIL_A).map((key) => key.breaks)).toEqual([false, false]);
    expect(keysATailHolds(entries, TAIL_A, `${A}-two`).map((key) => key.breaks)).toEqual([
      true,
      false,
    ]);
  });

  it('leaves out a key something revokes or retires, wherever that is written', () => {
    const entries = record({
      [TAIL_A]: [
        founded(A),
        enrolled(B),
        entry('agent.enrolled', { agentFp: D, name: 'bot', reverseSig: 'x' }),
        entry('checker.enrolled', { checkerFp: E, reverseSig: 'x' }),
      ],
      [TAIL_C]: [
        entry('key.revoked', { revokedFp: B, reason: 'r' }),
        entry('agent.retired', { agentFp: D, reason: 'r' }),
        entry('checker.retired', { checkerFp: E, reason: 'r' }),
      ],
    });
    expect(keysATailHolds(entries, TAIL_A).map((key) => key.fp)).toEqual([A]);
  });

  it('keeps a revoked key that signed events in a tail that stays, as one that breaks', () => {
    const entries = record({
      [TAIL_A]: [founded(A), enrolled(C), entry('key.revoked', { revokedFp: C, reason: 'r' })],
      [TAIL_C]: [entry('decision.recorded', {})],
    });
    expect(keysATailHolds(entries, TAIL_A).map((key) => [key.fp, key.breaks])).toEqual([
      [A, false],
      [C, true],
    ]);
    // Revoked in another tail, and its own tail cut already: nothing of it stays.
    const gone = record({
      [TAIL_A]: [founded(A), enrolled(C)],
      [TAIL_C]: [entry('key.revoked', { revokedFp: C, reason: 'r' })],
      [`${B}-one`]: [waiver(TAIL_C)],
    });
    expect(keysATailHolds(gone, TAIL_A).map((key) => key.fp)).toEqual([A]);
  });

  it('names a key once, and names none for a tail that introduces none or is absent', () => {
    expect(
      keysATailHolds(record({ [TAIL_A]: [founded(A), enrolled(A)] }), TAIL_A).map((k) => k.how),
    ).toEqual(['founded']);
    expect(keysATailHolds(record({ [TAIL_C]: [entry('decision.recorded', {})] }), TAIL_C)).toEqual(
      [],
    );
    expect(keysATailHolds(record({}), TAIL_A)).toEqual([]);
  });
});
