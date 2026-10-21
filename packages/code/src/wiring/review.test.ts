import { describe, expect, it } from 'vitest';
import { defaultReviewNote, verdictOf } from './review.js';

describe('the answer a person types at one decision', () => {
  it('reads a letter or a word for each of the four choices', () => {
    expect(verdictOf('a')).toEqual({ action: 'accept' });
    expect(verdictOf('Accept')).toEqual({ action: 'accept' });
    expect(verdictOf(' r ')).toEqual({ action: 'reject' });
    expect(verdictOf('skip')).toEqual({ action: 'skip' });
    expect(verdictOf('q')).toEqual({ action: 'quit' });
  });

  it('takes what follows an accept or a reject as the note for that decision', () => {
    expect(verdictOf('a the benchmark held')).toEqual({
      action: 'accept',
      note: 'the benchmark held',
    });
    expect(verdictOf('reject  too   early ')).toEqual({ action: 'reject', note: 'too early' });
    expect(verdictOf('s because')).toEqual({ action: 'skip' });
  });

  it('asks again on anything else, including an empty line', () => {
    expect(verdictOf('')).toEqual({ action: 'again' });
    expect(verdictOf('yes')).toEqual({ action: 'again' });
  });

  it('words the default note with the date and the verb', () => {
    expect(defaultReviewNote('2026-10-21')).toBe('2026-10-21, reviewed with mnema decision review');
  });
});
