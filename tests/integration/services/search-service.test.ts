import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
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

  it('returns matching tasks ordered by FTS rank', () => {
    const hits = search.search('oauth');
    expect(hits.map((h) => h.key)).toContain('TEST-1');
    expect(hits.every((h) => h.entity === 'task')).toBe(true);
  });

  it('matches across diacritics (sessao ≈ sessão)', () => {
    const hits = search.search('sessao');
    expect(hits.map((h) => h.key)).toContain('TEST-2');
  });

  it('returns empty array for unmatched queries', () => {
    expect(search.search('quantum cryptography')).toEqual([]);
  });

  it('respects per-entity limit', () => {
    const hits = search.search('login', { perEntityLimit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array for blank queries', () => {
    expect(search.search('   ')).toEqual([]);
  });
});
