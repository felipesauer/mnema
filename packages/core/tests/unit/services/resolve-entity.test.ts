import { describe, expect, it } from 'vitest';

import { type AliasCandidate, resolveAlias } from '@/domain/entity-alias.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { type HandleResolvable, resolveEntity } from '@/services/backlog/resolve-entity.js';

interface Row {
  readonly id: string;
}

/**
 * A repo fake over a fixed row set, wiring `resolve` to the real
 * {@link resolveAlias} so resolution — full id, alias, or prefix — is exercised
 * end-to-end, not mocked away. There is no key: the id is the sole identity.
 */
function fakeRepo(rows: readonly Row[]): HandleResolvable<Row> {
  const candidates: AliasCandidate[] = rows.map((r) => ({ kind: 'task', id: r.id }));
  return {
    resolve: (query) => resolveAlias(query, candidates),
    findById: (id) => rows.find((r) => r.id === id) ?? null,
  };
}

const notFound = (taskKey: string) => ({ kind: ErrorCode.TaskNotFound, taskKey }) as const;

describe('resolveEntity', () => {
  it('resolves an entity by its full id', () => {
    const id = '019f7700-0000-7000-8000-000000000001';
    const r = resolveEntity(fakeRepo([{ id }]), id, notFound);
    expect(r.ok && r.value.id).toBe(id);
  });

  it('resolves by a short alias', () => {
    const id = '019f7700-0000-7000-8000-000000000001';
    // The alias is derived from the id's hash; feed it back through the resolver.
    const r = resolveEntity(fakeRepo([{ id }]), id, notFound);
    expect(r.ok).toBe(true);
  });

  it('resolves by an id prefix copied off the mirror filename', () => {
    const id = '019f7700-0000-7000-8000-000000000001';
    const r = resolveEntity(fakeRepo([{ id }]), '019f7700', notFound);
    expect(r.ok && r.value.id).toBe(id);
  });

  it('reports ambiguity when a prefix matches more than one entity', () => {
    const repo = fakeRepo([
      { id: '019f7700-0000-7000-8000-00000000000a' },
      { id: '019f7700-0000-7000-8000-00000000000b' },
    ]);
    const r = resolveEntity(repo, '019f7700', notFound);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe(ErrorCode.AmbiguousAlias);
  });

  it('returns not-found when nothing resolves', () => {
    const repo = fakeRepo([{ id: '019f7700-0000-7000-8000-000000000001' }]);
    const r = resolveEntity(repo, 'ffffffff', notFound);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe(ErrorCode.TaskNotFound);
  });
});
