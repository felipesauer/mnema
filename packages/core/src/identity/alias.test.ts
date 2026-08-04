import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALIAS_PREFIXES, deriveAlias, SHORT_ALIAS_HEX } from './alias.js';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('deriveAlias', () => {
  it('is deterministic: same (kind, id) always yields the same alias', () => {
    const id = 'task-abc';
    expect(deriveAlias('task', id)).toBe(deriveAlias('task', id));
  });

  it('prefixes by kind', () => {
    const id = 'x';
    expect(deriveAlias('task', id).startsWith('t-')).toBe(true);
    expect(deriveAlias('epic', id).startsWith('e-')).toBe(true);
    expect(deriveAlias('sprint', id).startsWith('s-')).toBe(true);
  });

  it('the hex is the sha256 prefix of the id, not the id itself', () => {
    const id = 'task-abc';
    const alias = deriveAlias('task', id);
    expect(alias).toBe(`t-${sha256(id).slice(0, SHORT_ALIAS_HEX)}`);
    // and NOT derived from the id's own leading characters
    expect(alias).not.toBe(`t-${id.slice(0, SHORT_ALIAS_HEX)}`);
  });

  it('two ids that share a leading run (v7 timestamp analogue) do NOT share the alias', () => {
    // ids with an identical prefix would collide if we sliced the id; the hash
    // spreads them apart.
    const a = deriveAlias('task', '0190aaaa-0000-7000-8000-000000000001');
    const b = deriveAlias('task', '0190aaaa-0000-7000-8000-000000000002');
    expect(a).not.toBe(b);
  });

  it('produces the documented short length by default', () => {
    const alias = deriveAlias('task', 'anything');
    // `t-` + SHORT_ALIAS_HEX hex chars
    expect(alias.length).toBe(2 + SHORT_ALIAS_HEX);
  });

  it('covers every declared kind prefix', () => {
    for (const [kind, prefix] of Object.entries(ALIAS_PREFIXES)) {
      const alias = deriveAlias(kind as keyof typeof ALIAS_PREFIXES, 'z');
      expect(alias.startsWith(`${prefix}-`)).toBe(true);
    }
  });
});

describe('the short form collides, and that is the accepted cost', () => {
  /**
   * There used to be a `disambiguate` here that lengthened the ambiguous aliases
   * of a set shown together. It was removed because nothing shows two aliases at
   * once, so the set it needed never existed. This pair — which the deleted tests
   * used as the fixture that made the lengthening observable — stays as the pin
   * that the collision is REAL and accepted, rather than a sentence in a
   * docstring nobody can check.
   */
  it('two distinct ids share one alias, and the ids stay distinct', () => {
    const a = 'task-93';
    const b = 'task-367';
    expect(sha256(a).slice(0, SHORT_ALIAS_HEX)).toBe(sha256(b).slice(0, SHORT_ALIAS_HEX));
    expect(deriveAlias('task', a)).toBe(deriveAlias('task', b));
    expect(a).not.toBe(b);
  });

  it('a kind prefix separates what a hash prefix does not', () => {
    // The same overlap across kinds is not even a collision: `t-` and `e-` differ.
    expect(deriveAlias('task', 'task-93')).not.toBe(deriveAlias('epic', 'task-367'));
  });
});

describe('property: derivation is stable at scale', () => {
  it('two thousand ids derive deterministically, in the documented form', () => {
    for (let i = 0; i < 2000; i++) {
      const id = `t-${i}`;
      const alias = deriveAlias('task', id);
      expect(alias).toBe(deriveAlias('task', id));
      expect(alias).toBe(`t-${sha256(id).slice(0, SHORT_ALIAS_HEX)}`);
    }
  });
});
