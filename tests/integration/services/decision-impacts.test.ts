import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditService } from '@/services/audit-service.js';
import { DecisionService } from '@/services/decision-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { NoteRepository } from '@/storage/sqlite/repositories/note-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('DecisionService impacts', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let decisions: DecisionService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-di-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projects.insert({ key: 'TEST', name: 'Test' });
    const identity = new IdentityService(new ActorRepository(adapter));

    decisions = new DecisionService(
      new DecisionRepository(adapter),
      projects,
      identity,
      audit,
      new NoteRepository(adapter),
      new TaskRepository(adapter),
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('records a decision with impacts and reads them back', () => {
    const result = decisions.record({
      projectKey: 'TEST',
      title: 'Use SQLite',
      decision: 'SQLite it is',
      impacts: ['src/storage/foo.ts', 'TEST-42'],
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impacts).toEqual(['src/storage/foo.ts', 'TEST-42']);
  });

  it('defaults impacts to an empty array', () => {
    const result = decisions.record({
      projectKey: 'TEST',
      title: 'No impacts',
      decision: 'x',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impacts).toEqual([]);
  });

  it('impacting() returns decisions whose impacts contain the ref', () => {
    decisions.record({
      projectKey: 'TEST',
      title: 'A',
      decision: 'a',
      impacts: ['src/a.ts'],
      actor: 'daniel',
    });
    decisions.record({
      projectKey: 'TEST',
      title: 'B',
      decision: 'b',
      impacts: ['src/b.ts'],
      actor: 'daniel',
    });
    decisions.record({
      projectKey: 'TEST',
      title: 'C',
      decision: 'c',
      impacts: ['src/a.ts', 'src/c.ts'],
      actor: 'daniel',
    });

    const hits = decisions.impacting('TEST', 'src/a.ts');
    expect(hits).toHaveLength(2);
    expect(hits.map((d) => d.title).sort()).toEqual(['A', 'C']);
  });

  it('impacting() returns empty when nothing matches', () => {
    decisions.record({ projectKey: 'TEST', title: 'A', decision: 'a', actor: 'daniel' });
    expect(decisions.impacting('TEST', 'nope.ts')).toEqual([]);
  });
});
