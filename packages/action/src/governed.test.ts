import { describe, expect, it } from 'vitest';
import {
  approvedByAnotherPerson,
  bothReadings,
  isGoverned,
  leftOutOf,
  needingAPerson,
  rulesInForce,
} from './governed.js';

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

  it('leaves out a decision the record says a divergence keeps out of force, whatever its state, and keeps the reason', () => {
    const why = 'divergence between the accept by mnid:aaaaaaaa and the rejection by mnid:bbbbbbbb';
    const file = rulesInForce('src/a.ts', {
      rules: [{ ...hit('d1', 'accepted'), divergence: why }, hit('d2', 'accepted')],
      asks: [{ ...hit('d3', 'accepted'), divergence: why }],
      refuses: [{ ...hit('d4', 'rejected'), divergence: why }],
    });
    expect(file.governs).toEqual([{ id: 'd2', name: 'name of d2' }]);
    expect(file.asks).toEqual([]);
    expect(file.refuses).toEqual([]);
    expect(file.apart.map((one) => one.id)).toEqual(['d1', 'd3', 'd4']);
    expect(file.apart[0]?.divergence).toBe(why);
    expect(needingAPerson([file])).toEqual([]);
    expect(
      isGoverned(
        rulesInForce('src/a.ts', { rules: [{ ...hit('d1', 'accepted'), divergence: why }] }),
      ),
    ).toBe(true);
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

describe('needingAPerson', () => {
  it('keeps the files an accepted asks rule addresses', () => {
    const a = rulesInForce('a', { asks: [hit('d', 'accepted')] });
    const b = rulesInForce('b', { rules: [hit('d', 'accepted')] });
    expect(needingAPerson([a, b]).map((f) => f.path)).toEqual(['a']);
  });

  it('keeps the files an accepted refuses rule addresses, and not a superseded one', () => {
    const a = rulesInForce('a', { refuses: [hit('d', 'accepted')] });
    const b = rulesInForce('b', { refuses: [hit('d', 'superseded')] });
    expect(needingAPerson([a, b]).map((f) => f.path)).toEqual(['a']);
  });
});

describe('the tails of another record a reading left out', () => {
  const left = { tail: 'tail-a', record: 'a'.repeat(64) };

  it('are read off `anotherRecord` in the answer, whatever the file, and never make it governed', () => {
    const file = rulesInForce('src/a.ts', { rules: [], anotherRecord: [left, { tail: 1 }, 'x'] });
    expect(file.anotherRecord).toEqual([left]);
    expect(isGoverned(file)).toBe(false);
    expect(rulesInForce('src/a.ts', { rules: [] }).anotherRecord).toEqual([]);
  });

  it('are named once across files and across the two readings of one file', () => {
    const a = rulesInForce('a', { anotherRecord: [left] });
    const b = rulesInForce('b', { anotherRecord: [left] });
    expect(leftOutOf([a, b])).toEqual([left]);
    expect(bothReadings(a, rulesInForce('a', {})).anotherRecord).toEqual([left]);
  });
});
