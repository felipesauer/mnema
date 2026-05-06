import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { TaskState } from '@/domain/enums/task-state.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('repositories', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let actors: ActorRepository;
  let projects: ProjectRepository;
  let tasks: TaskRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-repo-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    actors = new ActorRepository(adapter);
    projects = new ProjectRepository(adapter);
    tasks = new TaskRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('ActorRepository', () => {
    it('upsert returns a new id for a new handle and reuses for existing', () => {
      const id1 = actors.upsert('daniel', ActorKind.Human);
      const id2 = actors.upsert('daniel', ActorKind.Human);

      expect(id1).toBe(id2);

      const actor = actors.findByHandle('daniel');
      expect(actor).not.toBeNull();
      expect(actor?.kind).toBe(ActorKind.Human);
      expect(actor?.handle).toBe('daniel');
    });

    it('separates human and agent actors by handle namespace', () => {
      const human = actors.upsert('daniel', ActorKind.Human);
      const agent = actors.upsert('agent:claude-code', ActorKind.Agent);

      expect(human).not.toBe(agent);
      expect(actors.findByHandle('agent:claude-code')?.kind).toBe(ActorKind.Agent);
    });
  });

  describe('ProjectRepository', () => {
    it('inserts and retrieves a project by key', () => {
      const created = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
      const found = projects.findByKey('WEBAPP');

      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Webapp');
      expect(found?.config).toEqual({});
    });

    it('returns null for unknown keys', () => {
      expect(projects.findByKey('GHOST')).toBeNull();
    });
  });

  describe('TaskRepository', () => {
    it('inserts a task and reads it back with parsed JSON fields', () => {
      const project = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
      const reporter = actors.upsert('daniel', ActorKind.Human);

      const created = tasks.insert({
        key: 'WEBAPP-1',
        projectId: project.id,
        title: 'First task',
        reporterId: reporter,
        description: 'Desc',
        acceptanceCriteria: ['one', 'two'],
        estimate: 5,
      });

      expect(created.key).toBe('WEBAPP-1');
      expect(created.state).toBe(TaskState.Draft);
      expect(created.acceptanceCriteria).toEqual(['one', 'two']);
      expect(created.priority).toBe(3);

      const found = tasks.findByKey('WEBAPP-1');
      expect(found?.id).toBe(created.id);
      expect(found?.acceptanceCriteria).toEqual(['one', 'two']);
    });

    it('findByState returns matching active tasks ordered by key', () => {
      const project = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
      const reporter = actors.upsert('daniel', ActorKind.Human);

      tasks.insert({
        key: 'WEBAPP-2',
        projectId: project.id,
        title: 'Second',
        reporterId: reporter,
      });
      tasks.insert({
        key: 'WEBAPP-1',
        projectId: project.id,
        title: 'First',
        reporterId: reporter,
      });

      const drafts = tasks.findByState(TaskState.Draft);
      expect(drafts.map((t) => t.key)).toEqual(['WEBAPP-1', 'WEBAPP-2']);
    });

    it('countActive ignores soft-deleted tasks', () => {
      const project = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
      const reporter = actors.upsert('daniel', ActorKind.Human);

      tasks.insert({ key: 'WEBAPP-1', projectId: project.id, title: 'A', reporterId: reporter });
      tasks.insert({ key: 'WEBAPP-2', projectId: project.id, title: 'B', reporterId: reporter });

      expect(tasks.countActive()).toBe(2);

      adapter
        .getDatabase()
        .prepare("UPDATE tasks SET deleted_at = datetime('now') WHERE key = 'WEBAPP-1'")
        .run();

      expect(tasks.countActive()).toBe(1);
    });
  });
});
