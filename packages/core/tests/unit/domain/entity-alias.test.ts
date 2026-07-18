import { describe, expect, it } from 'vitest';

import { aliasMatches, deriveAlias } from '@/domain/entity-alias.js';
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
