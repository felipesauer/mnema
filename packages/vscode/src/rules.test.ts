import { describe, expect, it } from 'vitest';
import { lensTitle, readRules, ruleLabel } from './rules.js';

const rule = (over: Record<string, unknown>) => ({
  rule: 'id-1',
  kind: 'decision',
  name: 'Use X',
  state: 'accepted',
  acceptance: { by: 'mnid:aea90cbb', unconfirmed: false },
  ...over,
});

const seen = (id: string, name: string, relation: string) => ({
  id,
  name,
  relation,
  acceptedBy: 'mnid:aea90cbb',
  unconfirmed: false,
});

describe('the rules over a file, as `mnema rules --json` says them', () => {
  it('reads the three relations, with who accepted each', () => {
    const json = JSON.stringify({
      rules: [rule({})],
      asks: [rule({ rule: 'id-2', name: 'Ask first' })],
      refuses: [rule({ rule: 'id-3', name: 'No writes' })],
    });
    expect(readRules(json)).toEqual([
      seen('id-1', 'Use X', 'governs'),
      seen('id-2', 'Ask first', 'asks-for-a-person'),
      seen('id-3', 'No writes', 'refuses-a-write'),
    ]);
  });

  it('keeps only decisions in force: a superseded or proposed one, and a skill, are dropped', () => {
    const json = JSON.stringify({
      rules: [
        rule({ rule: 'a', state: 'superseded' }),
        rule({ rule: 'b', state: 'proposed' }),
        rule({ rule: 'c', kind: 'skill' }),
        rule({ rule: 'd' }),
      ],
    });
    expect(readRules(json).map((r) => r.id)).toEqual(['d']);
  });

  it('says it was not confirmed when the record says nobody else has looked', () => {
    const json = JSON.stringify({
      rules: [rule({ acceptance: { by: 'mnid:x', unconfirmed: true } })],
    });
    expect(readRules(json)[0]?.unconfirmed).toBe(true);
  });

  it('reads nothing out of what is not the answer', () => {
    expect(readRules('not json')).toEqual([]);
    expect(readRules('[1]')).toEqual([]);
    expect(readRules('{"rules": 3}')).toEqual([]);
  });

  it('titles the lens by what the rules do, and has none for an unaddressed file', () => {
    expect(lensTitle([])).toBeUndefined();
    const all = readRules(
      JSON.stringify({
        rules: [rule({})],
        asks: [rule({ rule: 'b' })],
        refuses: [rule({ rule: 'c' })],
      }),
    );
    expect(lensTitle(all)).toBe('mnema: 1 governs, 1 asks for a person, 1 refuses a write');
    expect(lensTitle(all.slice(0, 1))).toBe('mnema: 1 governs');
  });

  it('labels a rule with its name, what it does and who accepted it', () => {
    const [one] = readRules(JSON.stringify({ rules: [rule({})] }));
    expect(one && ruleLabel(one)).toEqual({
      label: 'Use X',
      description: 'governs · accepted by mnid:aea90cbb',
    });
  });
});
