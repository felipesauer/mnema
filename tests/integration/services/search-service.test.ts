import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { SearchService } from '@/services/search-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('SearchService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let search: SearchService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-search-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const actors = new ActorRepository(adapter);
    const projects = new ProjectRepository(adapter);
    const tasks = new TaskRepository(adapter);

    const project = projects.insert({ key: 'TEST', name: 'Test' });
    const reporterId = actors.upsert('daniel', ActorKind.Human);

    tasks.insert({
      key: 'TEST-1',
      projectId: project.id,
      title: 'Implement OAuth login',
      description: 'Add Google OAuth flow',
      acceptanceCriteria: ['Users authenticate'],
      reporterId,
    });
    tasks.insert({
      key: 'TEST-2',
      projectId: project.id,
      title: 'Refactor authentication',
      description: 'Reescrever a camada de sessão',
      acceptanceCriteria: ['Compatible with current API'],
      reporterId,
    });
    tasks.insert({
      key: 'TEST-3',
      projectId: project.id,
      title: 'Improve dashboard',
      description: 'Latency tweaks for metrics page',
      reporterId,
    });

    search = new SearchService(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function hitsOrThrow(query: string, filter?: Parameters<typeof search.search>[1]) {
    const result = search.search(query, filter);
    if (!result.ok) throw new Error(`expected hits, got error: ${JSON.stringify(result.error)}`);
    return result.value;
  }

  it('returns matching tasks ordered by FTS rank', () => {
    const hits = hitsOrThrow('oauth');
    expect(hits.map((h) => h.key)).toContain('TEST-1');
    expect(hits.every((h) => h.entity === 'task')).toBe(true);
  });

  it('matches across diacritics (sessao ≈ sessão)', () => {
    const hits = hitsOrThrow('sessao');
    expect(hits.map((h) => h.key)).toContain('TEST-2');
  });

  it('returns empty array for unmatched queries', () => {
    expect(hitsOrThrow('quantum cryptography')).toEqual([]);
  });

  it('respects per-entity limit', () => {
    const hits = hitsOrThrow('login', { perEntityLimit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array for blank queries', () => {
    expect(hitsOrThrow('   ')).toEqual([]);
  });

  it('invalid FTS query returns SearchInvalidQuery instead of throwing', () => {
    const result = search.search('sql; DROP');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.SearchInvalidQuery);
    if (result.error.kind !== ErrorCode.SearchInvalidQuery) return;
    expect(result.error.query).toBe('sql; DROP');
    expect(result.error.detail.toLowerCase()).toMatch(/fts5|syntax/);
  });

  it('2.2: searches skills (latest version only) by content', () => {
    const db = adapter.getDatabase();
    db.prepare(
      `INSERT INTO skills (id, slug, name, version, description, content, tools_used, created_by)
       VALUES
         ('s1', 'safe-migrate', 'Safe migrate v1', 1, 'd', 'how to roll a migration safely', '[]',
          (SELECT id FROM actors WHERE handle = 'daniel')),
         ('s2', 'safe-migrate', 'Safe migrate v2', 2, 'd', 'updated migration guide v2', '[]',
          (SELECT id FROM actors WHERE handle = 'daniel'))`,
    ).run();

    const hits = hitsOrThrow('migration', { entities: ['skill'] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entity).toBe('skill');
    expect(hits[0]?.key).toBe('safe-migrate');
    expect(hits[0]?.snippet.toLowerCase()).toContain('migration');
  });

  it('2.2: searches memories by title and content', () => {
    const db = adapter.getDatabase();
    db.prepare(
      `INSERT INTO memories (id, slug, title, content, topics, created_by)
       VALUES ('m1', 'pci', 'PCI compliance is mandatory', 'Client requires PCI-DSS', '[]',
              (SELECT id FROM actors WHERE handle = 'daniel'))`,
    ).run();
    const hits = hitsOrThrow('PCI', { entities: ['memory'] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entity).toBe('memory');
    expect(hits[0]?.key).toBe('pci');
  });

  it('2.2: searches observations by content', () => {
    const db = adapter.getDatabase();
    db.prepare(
      `INSERT INTO observations (id, content, topics, created_by)
       VALUES ('o1', 'Build flaky on Friday afternoon', '[]',
               (SELECT id FROM actors WHERE handle = 'daniel'))`,
    ).run();
    const hits = hitsOrThrow('flaky', { entities: ['observation'] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entity).toBe('observation');
    expect(hits[0]?.key).toBeNull();
    expect(hits[0]?.snippet.toLowerCase()).toContain('flaky');
  });
});
