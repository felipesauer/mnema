import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('task context_budget column', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-cb-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);
    tasks = new TaskRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('defaults context_budget to null when not provided', () => {
    const task = tasks.insert({ key: 'TEST-1', projectId, title: 'A', reporterId: actorId });
    expect(task.contextBudget).toBeNull();
  });

  it('persists and reads back a context_budget', () => {
    const created = tasks.insert({
      key: 'TEST-2',
      projectId,
      title: 'B',
      reporterId: actorId,
      contextBudget: 80_000,
    });
    expect(created.contextBudget).toBe(80_000);

    // round-trips through a fresh read
    const reloaded = tasks.findByKey('TEST-2');
    expect(reloaded?.contextBudget).toBe(80_000);
  });

  it('keeps context_budget independent of estimate', () => {
    const task = tasks.insert({
      key: 'TEST-3',
      projectId,
      title: 'C',
      reporterId: actorId,
      estimate: 5,
      contextBudget: 120_000,
    });
    expect(task.estimate).toBe(5);
    expect(task.contextBudget).toBe(120_000);
  });
});
