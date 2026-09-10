import { describe, expect, it } from 'vitest';
import { proofColumn, proofFromColumn, proofOf, proofText } from './proof.js';

/** One move, in the shape the fold reads it through. */
const move = (action: string, at: string, fields?: Record<string, string>) => ({
  at,
  payload: { action, ...(fields !== undefined ? { fields } : {}) },
});

describe('proofOf', () => {
  it('names the move and what it said', () => {
    expect(proofOf(move('complete', 'T1', { note: 'capped at four' }))).toEqual({
      action: 'complete',
      at: 'T1',
      said: 'note: capped at four',
    });
  });

  it('is undefined when the move said nothing', () => {
    // The single site that decides what "carried proof" means, so three folds cannot
    // come to disagree. Both ways of saying nothing answer the same.
    expect(proofOf(move('start', 'T1'))).toBeUndefined();
    expect(proofOf(move('start', 'T1', {}))).toBeUndefined();
  });
});

describe('proofText', () => {
  it('is the prose of every move and nothing else', () => {
    const proof = [
      { action: 'complete', at: 'T1', said: 'note: one' },
      { action: 'reopen', at: 'T2', said: 'reason: two' },
    ];
    // The ACTION and the INSTANT are left out on purpose: they are already indexed as
    // structure, and folding the word `complete` into the body of every completed task
    // would make it match half the record and rank as if somebody had written it.
    expect(proofText(proof)).toBe('note: one\nreason: two');
    expect(proofText(proof)).not.toContain('complete');
    expect(proofText(proof)).not.toContain('T1');
  });

  it('is empty when there is nothing to index', () => {
    expect(proofText(undefined)).toBe('');
    expect(proofText([])).toBe('');
  });
});

describe('the column, both ways', () => {
  it('round-trips a proof through one TEXT column', () => {
    const proof = [{ action: 'complete', at: 'T1', said: 'note: one' }];
    const column = proofColumn(proof);
    expect(column).not.toBeNull();
    expect(proofFromColumn(column as string)).toEqual({ proof });
  });

  it('keeps ABSENCE absent across the round trip', () => {
    // NULL and not `'[]'`, and the decoded shape has NO KEY rather than an empty
    // array: every consumer checks for the key, and `[]` would read as "derived from
    // nothing in particular" — the same distinction the decision's `alternatives`
    // column already keeps.
    expect(proofColumn(undefined)).toBeNull();
    expect(proofColumn([])).toBeNull();
    expect(proofFromColumn(null)).toEqual({});
    expect(Object.keys(proofFromColumn(null))).toEqual([]);
    // And a column that somehow holds an empty list decodes to absence too, so the two
    // encodings of "nothing" cannot come back as two different answers.
    expect(proofFromColumn('[]')).toEqual({});
  });
});
