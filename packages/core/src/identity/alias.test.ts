import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ALIAS_PREFIXES,
  type AliasSubject,
  deriveAlias,
  disambiguate,
  SHORT_ALIAS_HEX,
} from './alias.js';

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

describe('disambiguate', () => {
  it('leaves non-colliding ids at the short default', () => {
    const subjects: AliasSubject[] = [
      { kind: 'task', id: 'task-1' },
      { kind: 'task', id: 'task-2' },
    ];
    const map = disambiguate(subjects);
    // these two do not collide at 4 hex (verified: distinct short aliases)
    expect(map.get('task-1')).toBe(deriveAlias('task', 'task-1'));
    expect(map.get('task-2')).toBe(deriveAlias('task', 'task-2'));
    expect(map.get('task-1')).not.toBe(map.get('task-2'));
  });

  it('lengthens ONLY the ambiguous ids to the shortest distinguishing prefix', () => {
    // task-93 and task-367 share the first 4 hex (80af) and diverge at 5.
    const a = 'task-93';
    const b = 'task-367';
    expect(sha256(a).slice(0, 4)).toBe(sha256(b).slice(0, 4));
    expect(sha256(a).slice(0, 5)).not.toBe(sha256(b).slice(0, 5));

    const map = disambiguate([
      { kind: 'task', id: a },
      { kind: 'task', id: b },
      { kind: 'task', id: 'task-1' }, // an unrelated, non-colliding task
    ]);

    // the colliding pair grew to 5 hex and is now distinct
    expect(map.get(a)).toBe(`t-${sha256(a).slice(0, 5)}`);
    expect(map.get(b)).toBe(`t-${sha256(b).slice(0, 5)}`);
    expect(map.get(a)).not.toBe(map.get(b));

    // the unrelated task stayed short
    expect(map.get('task-1')).toBe(deriveAlias('task', 'task-1'));
  });

  it('resolves a three-way collision: each grows just far enough to be unique', () => {
    // k-67, k-256, k-324 all share the first 4 hex (675c); each must grow
    // enough to be distinct from BOTH others, not just one.
    const ids = ['k-67', 'k-256', 'k-324'];
    expect(new Set(ids.map((id) => sha256(id).slice(0, 4))).size).toBe(1);

    const map = disambiguate(ids.map((id) => ({ kind: 'task' as const, id })));
    const aliases = ids.map((id) => map.get(id) as string);

    // all three distinct
    expect(new Set(aliases).size).toBe(3);
    // each is a genuine prefix-extension of its own full hash
    for (const id of ids) {
      expect(`t-${sha256(id)}`.startsWith(map.get(id) as string)).toBe(true);
    }
  });

  it('does not confuse ids of different kinds (the prefix already separates)', () => {
    // even if a task hash and an epic hash shared 4 hex, t- vs e- keeps them
    // apart, so neither needs to grow.
    const map = disambiguate([
      { kind: 'task', id: 'task-93' },
      { kind: 'epic', id: 'task-367' }, // different kind, ignore any hash overlap
    ]);
    expect(map.get('task-93')).toBe(deriveAlias('task', 'task-93'));
    expect(map.get('task-367')).toBe(deriveAlias('epic', 'task-367'));
  });

  it('maps a repeated id once', () => {
    const map = disambiguate([
      { kind: 'task', id: 'task-1' },
      { kind: 'task', id: 'task-1' },
    ]);
    expect(map.size).toBe(1);
    expect(map.get('task-1')).toBe(deriveAlias('task', 'task-1'));
  });

  it('handles an empty set', () => {
    expect(disambiguate([]).size).toBe(0);
  });

  it('a solitary id stays at the short default', () => {
    const map = disambiguate([{ kind: 'task', id: 'task-93' }]);
    expect(map.get('task-93')).toBe(deriveAlias('task', 'task-93'));
  });
});

describe('property: derivation is stable and collisions always resolve', () => {
  it('many ids derive deterministically and disambiguate to unique aliases per kind', () => {
    const subjects: AliasSubject[] = [];
    for (let i = 0; i < 2000; i++) {
      subjects.push({ kind: 'task', id: `t-${i}` });
    }

    // deterministic: deriving twice gives the same short alias
    for (const { kind, id } of subjects) {
      expect(deriveAlias(kind, id)).toBe(deriveAlias(kind, id));
    }

    const map = disambiguate(subjects);
    expect(map.size).toBe(subjects.length);

    // every alias in the set is unique — collisions were resolved by lengthening
    const aliases = [...map.values()];
    expect(new Set(aliases).size).toBe(aliases.length);

    // and every resolved alias is still a prefix-extension of the short form
    for (const { id } of subjects) {
      const full = `t-${sha256(id)}`;
      const alias = map.get(id) as string;
      expect(full.startsWith(alias)).toBe(true);
      expect(alias.length).toBeGreaterThanOrEqual(2 + SHORT_ALIAS_HEX);
    }
  });
});
