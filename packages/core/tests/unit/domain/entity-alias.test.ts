import { describe, expect, it } from 'vitest';

import {
  type AliasCandidate,
  aliasMatches,
  deriveAlias,
  resolveAlias,
} from '@/domain/entity-alias.js';
import { generateUuid } from '@/domain/id-generator.js';

/**
 * The alias is CLI/display ergonomics over the committed id: a short,
 * kind-prefixed handle (`t-3a9f`) that resolves back to exactly one entity, and
 * auto-lengthens on the rare clash the way `git show <short-sha>` does. It is
 * never the identity — that is always the id.
 */
describe('entity alias', () => {
  it('derives a kind-prefixed short handle from the id', () => {
    const id = '019f76e4-e277-773a-865e-76f4170a644e';
    expect(deriveAlias('task', id)).toMatch(/^t-[0-9a-f]{4}$/);
    expect(deriveAlias('epic', id)).toMatch(/^e-[0-9a-f]{4}$/);
    expect(deriveAlias('sprint', id)).toMatch(/^s-[0-9a-f]{4}$/);
    expect(deriveAlias('decision', id)).toMatch(/^d-[0-9a-f]{4}$/);
  });

  it('does NOT derive the alias from the id prefix (v7 timestamp does not discriminate)', () => {
    // Two ids created in the same millisecond share a long leading prefix (the
    // v7 timestamp). Their aliases must still differ — proof the alias comes
    // from a HASH of the id, not the id's own head.
    const a = generateUuid();
    const b = generateUuid();
    expect(a.slice(0, 8)).toBe(b.slice(0, 8)); // same timestamp prefix
    // Longer aliases (so a 4-char clash is not what's being tested) must differ.
    expect(deriveAlias('task', a, 12)).not.toBe(deriveAlias('task', b, 12));
  });

  it('resolves the full id, the full alias, and a partial alias', () => {
    const id = '019f76e4-e277-773a-865e-76f4170a644e';
    const alias = deriveAlias('task', id); // e.g. t-XXXX
    expect(aliasMatches(id, 'task', id)).toBe(true); // full id
    expect(aliasMatches(alias, 'task', id)).toBe(true); // full alias
    expect(aliasMatches(alias.slice(0, 3), 'task', id)).toBe(true); // t-X partial
  });

  it('does not resolve across kinds (a task alias never matches an epic)', () => {
    const id = '019f76e4-e277-773a-865e-76f4170a644e';
    const taskAlias = deriveAlias('task', id);
    // Same id, but the caller asks whether it matches an EPIC — the `t-` prefix
    // must not match the epic kind.
    expect(aliasMatches(taskAlias, 'epic', id)).toBe(false);
  });

  it('matches a bare hash prefix against any kind', () => {
    const id = '019f76e4-e277-773a-865e-76f4170a644e';
    const alias = deriveAlias('task', id);
    const bareHex = alias.slice(2); // drop the "t-"
    expect(aliasMatches(bareHex, 'task', id)).toBe(true);
    expect(aliasMatches(bareHex, 'epic', id)).toBe(true); // kindless, hash-only
  });

  it('a wrong hex tail does not resolve', () => {
    const id = '019f76e4-e277-773a-865e-76f4170a644e';
    // A tail that is not a prefix of this id's alias hash.
    const hash = deriveAlias('task', id, 12).slice(2);
    const wrong = `${hash[0] === 'f' ? 'e' : 'f'}${hash.slice(1)}`;
    expect(aliasMatches(`t-${wrong}`, 'task', id)).toBe(false);
  });
});

/**
 * The resolver turns a user handle into exactly one id — or reports ambiguity so
 * the caller asks for more characters. It is the collection layer over
 * {@link aliasMatches}: match every candidate, then decide unique/ambiguous/none.
 */
describe('resolveAlias', () => {
  const idA = '019f76e4-e277-773a-865e-76f4170a644e';
  const idB = '019f76e4-e277-773a-865e-000000000000';
  const candidates: AliasCandidate[] = [
    { kind: 'task', id: idA },
    { kind: 'task', id: idB },
  ];

  it('resolves a full id to a unique match', () => {
    const r = resolveAlias(idA, candidates);
    expect(r).toEqual({ status: 'unique', id: idA });
  });

  it('resolves a full alias to a unique match', () => {
    const r = resolveAlias(deriveAlias('task', idB), candidates);
    expect(r).toEqual({ status: 'unique', id: idB });
  });

  it('reports none when nothing matches', () => {
    expect(resolveAlias('t-zzzz', candidates)).toEqual({ status: 'none' });
    expect(resolveAlias('nope', candidates)).toEqual({ status: 'none' });
  });

  it('reports ambiguous with every match when a prefix is shared', () => {
    // Force a shared prefix: two synthetic candidates whose alias hashes we make
    // collide on the first char by searching a couple of ids is overkill — instead
    // query the kind prefix alone, which every task alias shares.
    const r = resolveAlias('t-', candidates);
    expect(r.status).toBe('ambiguous');
    if (r.status !== 'ambiguous') return;
    expect([...r.ids].sort()).toEqual([idA, idB].sort());
  });

  it('auto-lengthens: enough characters single one out', () => {
    // The full alias of A is unique among the two candidates.
    const aliasA = deriveAlias('task', idA, 12);
    const r = resolveAlias(aliasA, candidates);
    expect(r).toEqual({ status: 'unique', id: idA });
  });

  it('a bare hash prefix matches across kinds but still resolves uniquely', () => {
    const bare = deriveAlias('task', idA, 12).slice(2); // drop "t-"
    const mixed: AliasCandidate[] = [
      { kind: 'task', id: idA },
      { kind: 'epic', id: idB },
    ];
    expect(resolveAlias(bare, mixed)).toEqual({ status: 'unique', id: idA });
  });
});
