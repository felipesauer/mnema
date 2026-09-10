import { describe, expect, it } from 'vitest';
import type { CatalogEvent } from './catalog.js';
import { PROOF_FIELDS, proofFields, transitionProse } from './proof.js';

/** An envelope's required parts, so a case can build a real catalog event. */
const ENVELOPE = {
  v: 1,
  at: '2026-09-10T00:00:00.000Z',
  who: 'mnid:aa',
  subject: 's-1',
} as const;

describe('transitionProse', () => {
  it('reads every field the catalog can carry, in the module’s own order', () => {
    // Enumerated against `PROOF_FIELDS`, which is derived from a mapped type over
    // `TransitionFields` — a sixth field does not compile until it is ranked, and this
    // is what says the ranking reached the text.
    expect([...PROOF_FIELDS]).toEqual(['reason', 'note', 'feedback', 'pr_url', 'links']);
    expect(
      transitionProse({
        // Written out of order on purpose: the reading order is this module's, not the
        // order a writer happened to serialize the object in, so two records holding
        // the same proof read the same way.
        links: ['a', 'b'],
        note: 'n',
        reason: 'r',
        pr_url: 'u',
        feedback: 'f',
      }).split('\n'),
    ).toEqual(['reason: r', 'note: n', 'feedback: f', 'pr_url: u', 'links: a b']);
  });

  it('says nothing when the move said nothing', () => {
    // Three ways of carrying no proof, and all three have to answer the same, because
    // every caller treats `''` as "no proof" and prints no heading over it.
    expect(transitionProse(undefined)).toBe('');
    expect(transitionProse({})).toBe('');
    expect(transitionProse({ note: '' })).toBe('');
  });

  it('names only the fields that are there', () => {
    expect(transitionProse({ note: 'n' })).toBe('note: n');
    expect(transitionProse({ reason: 'r', note: 'n' })).toBe('reason: r\nnote: n');
  });

  it('keeps a newline inside a value, and does not decide what to do with it', () => {
    // The collapse belongs to whoever puts the value on a LINE: `show` serves this
    // whole under a heading and the history collapses it. A blanket collapse here
    // would take that choice away from both.
    expect(transitionProse({ note: `two${String.fromCharCode(10)}lines` })).toBe(
      `note: two${String.fromCharCode(10)}lines`,
    );
  });
});

describe('proofFields', () => {
  it('reads the fields of each of the three moves', () => {
    const moves: CatalogEvent[] = [
      {
        ...ENVELOPE,
        kind: 'task.transitioned',
        payload: { from: 'IN_PROGRESS', to: 'DONE', action: 'complete', fields: { note: 'n' } },
      },
      {
        ...ENVELOPE,
        kind: 'decision.transitioned',
        payload: { from: 'proposed', to: 'accepted', action: 'accept', fields: { note: 'n' } },
      },
      {
        ...ENVELOPE,
        kind: 'skill.transitioned',
        payload: { from: 'proposed', to: 'reviewed', action: 'review', fields: { note: 'n' } },
      },
    ];
    for (const move of moves) {
      expect(proofFields(move), `${move.kind} carries its proof`).toEqual({ note: 'n' });
    }
    // The list is not a list this file keeps: it is every kind the totality guard in
    // `proof.ts` requires, so a fourth state machine reddens the compiler there and
    // this case the moment it is added.
    expect(moves).toHaveLength(3);
  });

  it('reads a move that carried nothing as nothing', () => {
    expect(
      proofFields({
        ...ENVELOPE,
        kind: 'task.transitioned',
        payload: { from: null, to: 'DRAFT', action: 'create' },
      }),
    ).toBeUndefined();
  });

  it('is undefined for an event that is not a move at all', () => {
    // The other half, and the one that stops this from answering about every event: a
    // fact with no `action` has no proof to read, and reporting one would be inventing.
    expect(
      proofFields({ ...ENVELOPE, kind: 'task.created', payload: { title: 't' } }),
    ).toBeUndefined();
    expect(
      proofFields({ ...ENVELOPE, kind: 'memory.captured', payload: { content: 'c' } }),
    ).toBeUndefined();
    expect(
      proofFields({
        ...ENVELOPE,
        kind: 'knowledge.linked',
        payload: { target: 'x', rel: 'relates-to' },
      }),
    ).toBeUndefined();
  });
});
