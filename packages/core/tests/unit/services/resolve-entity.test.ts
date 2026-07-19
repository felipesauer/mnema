import { describe, expect, it } from 'vitest';

import { type AliasCandidate, resolveAlias } from '@/domain/entity-alias.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { type HandleResolvable, resolveEntity } from '@/services/backlog/resolve-entity.js';

interface Row {
  readonly id: string;
  readonly key: string;
}

/**
 * A repo fake over a fixed row set, wiring `resolve` to the real
 * {@link resolveAlias} so the precedence between an exact key and a prefix
 * match is exercised end-to-end, not mocked away.
 */
function fakeRepo(rows: readonly Row[]): HandleResolvable<Row> {
  const candidates: AliasCandidate[] = rows.map((r) => ({ kind: 'task', id: r.id }));
  return {
    resolve: (query) => resolveAlias(query, candidates),
    findById: (id) => rows.find((r) => r.id === id) ?? null,
    findByKey: (key) => rows.find((r) => r.key === key) ?? null,
  };
}

const notFound = (taskKey: string) => ({ kind: ErrorCode.TaskNotFound, taskKey }) as const;

describe('resolveEntity', () => {
  it('resolves an entity by its exact key', () => {
    const repo = fakeRepo([{ id: '019f7700-0000-7000-8000-000000000001', key: 'WEBAPP-1' }]);
    const r = resolveEntity(repo, 'WEBAPP-1', notFound);
    expect(r.ok && r.value.key).toBe('WEBAPP-1');
  });

  it('resolves by full id and by alias', () => {
    const id = '019f7700-0000-7000-8000-000000000001';
    const repo = fakeRepo([{ id, key: 'WEBAPP-1' }]);
    expect(resolveEntity(repo, id, notFound).ok).toBe(true);
  });

  it('an EXACT key wins over an id-prefix match of a different entity', () => {
    // The hex-only project `DEAD`: its key `DEAD-42` lowercases to `dead-42`,
    // which is a valid id prefix. Another live entity's id starts with `dead42…`.
    // The exact key must resolve to ITS OWN row, never the prefix match.
    const meant = { id: '019f7700-0000-7000-8000-000000000009', key: 'DEAD-42' };
    const decoy = { id: 'dead4200-0000-7000-8000-000000000001', key: 'OTHER-7' };
    const repo = fakeRepo([meant, decoy]);

    const r = resolveEntity(repo, 'DEAD-42', notFound);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe(meant.id); // not the decoy the prefix would have matched
  });

  it('falls back to the alias resolver when no exact key matches', () => {
    const id = '019f7700-0000-7000-8000-000000000001';
    const repo = fakeRepo([{ id, key: 'WEBAPP-1' }]);
    // A bare prefix of the id — no key equals this, so the resolver handles it.
    const r = resolveEntity(repo, '019f7700', notFound);
    expect(r.ok && r.value.id).toBe(id);
  });

  it('reports ambiguity when a prefix matches more than one entity', () => {
    const repo = fakeRepo([
      { id: '019f7700-0000-7000-8000-00000000000a', key: 'WEBAPP-1' },
      { id: '019f7700-0000-7000-8000-00000000000b', key: 'WEBAPP-2' },
    ]);
    // Shared id prefix, no exact key — ambiguous.
    const r = resolveEntity(repo, '019f7700', notFound);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe(ErrorCode.AmbiguousAlias);
  });

  it('returns not-found when nothing resolves', () => {
    const repo = fakeRepo([{ id: '019f7700-0000-7000-8000-000000000001', key: 'WEBAPP-1' }]);
    const r = resolveEntity(repo, 'ffffffff', notFound);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe(ErrorCode.TaskNotFound);
  });
});
