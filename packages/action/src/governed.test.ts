import { describe, expect, it } from 'vitest';
import { approvedByAnotherPerson, askingForAPerson, isGoverned, rulesInForce } from './governed.js';

const hit = (rule: string, state: string, kind = 'decision') => ({
  rule,
  name: `name of ${rule}`,
  kind,
  state,
});

describe('rulesInForce', () => {
  it('keeps the accepted decisions, by what each rule does, and drops the rest', () => {
    const file = rulesInForce('src/a.ts', {
      rules: [hit('d1', 'accepted'), hit('d2', 'proposed'), hit('d3', 'rejected')],
      asks: [hit('d4', 'accepted'), hit('s1', 'adopted', 'skill')],
      refuses: [hit('d5', 'superseded')],
    });
    expect(file.governs).toEqual([{ id: 'd1', name: 'name of d1' }]);
    expect(file.asks).toEqual([{ id: 'd4', name: 'name of d4' }]);
    expect(file.refuses).toEqual([]);
    expect(isGoverned(file)).toBe(true);
  });

  it('reads an answer it does not understand as addressing nothing', () => {
    expect(isGoverned(rulesInForce('x', null))).toBe(false);
    expect(isGoverned(rulesInForce('x', { rules: 'no' }))).toBe(false);
  });
});

describe('approvedByAnotherPerson', () => {
  const by = (user: string, state: string) => ({ user, state });

  it('counts an approval from someone who is not the author', () => {
    expect(approvedByAnotherPerson([by('ana', 'APPROVED')], 'bob')).toBe(true);
  });

  it('does not count the author approving their own pull request', () => {
    expect(approvedByAnotherPerson([by('bob', 'APPROVED')], 'bob')).toBe(false);
  });

  it('does not count a comment, or no review at all', () => {
    expect(approvedByAnotherPerson([by('ana', 'COMMENTED')], 'bob')).toBe(false);
    expect(approvedByAnotherPerson([], 'bob')).toBe(false);
  });

  it('takes a reviewer by their latest deciding review', () => {
    const asked = [by('ana', 'APPROVED'), by('ana', 'CHANGES_REQUESTED')];
    expect(approvedByAnotherPerson(asked, 'bob')).toBe(false);
    expect(approvedByAnotherPerson([...asked, by('ana', 'APPROVED')], 'bob')).toBe(true);
    // a plain comment after an approval does not withdraw it
    expect(approvedByAnotherPerson([by('ana', 'APPROVED'), by('ana', 'COMMENTED')], 'bob')).toBe(
      true,
    );
  });
});

describe('askingForAPerson', () => {
  it('keeps the files an accepted asks rule addresses', () => {
    const a = rulesInForce('a', { asks: [hit('d', 'accepted')] });
    const b = rulesInForce('b', { rules: [hit('d', 'accepted')] });
    expect(askingForAPerson([a, b]).map((f) => f.path)).toEqual(['a']);
  });
});
