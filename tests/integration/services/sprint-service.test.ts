import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SprintState } from '@/domain/enums/sprint-state.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { SprintService } from '@/services/sprint-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('SprintService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let sprints: SprintService;
  let tasks: TaskRepository;
  let projects: ProjectRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-sprint-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const sprintRepo = new SprintRepository(adapter);
    tasks = new TaskRepository(adapter);
    projects = new ProjectRepository(adapter);

    sprints = new SprintService(sprintRepo, tasks, projects, audit);

    projects.insert({ key: 'TEST', name: 'Test' });
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('plans a sprint in PLANNED state with key derived from project', () => {
    const result = sprints.plan({
      projectKey: 'TEST',
      name: 'Sprint 1',
      goal: 'ship auth',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe('TEST-SPRINT-1');
    expect(result.value.state).toBe(SprintState.Planned);
    expect(result.value.goal).toBe('ship auth');
  });

  it('starts a planned sprint and forbids a second active sprint', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });
    sprints.plan({ projectKey: 'TEST', name: 'B', actor: 'daniel' });

    const started = sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    expect(started.ok).toBe(true);

    const second = sprints.start({ sprintKey: 'TEST-SPRINT-2', actor: 'daniel' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.ActiveSprintExists);
  });

  it('rejects start on a non-planned sprint', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });
    sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });

    const restart = sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    expect(restart.ok).toBe(false);
    if (restart.ok) return;
    expect(restart.error.kind).toBe(ErrorCode.SprintInvalidState);
  });

  it('closes an active sprint and stamps closed_at', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });
    sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });

    const closed = sprints.close({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value.state).toBe(SprintState.Closed);
    expect(closed.value.closedAt).not.toBeNull();
  });

  it('rejects close on a planned sprint', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });

    const closed = sprints.close({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(closed.error.kind).toBe(ErrorCode.SprintInvalidState);
  });

  it('attaches and removes tasks from a sprint', () => {
    const project = projects.findByKey('TEST');
    if (project === null) throw new Error('precondition: project exists');
    tasks.insert({
      key: 'TEST-1',
      projectId: project.id,
      title: 'A',
      reporterId: 'a1',
    });

    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });

    const added = sprints.addTask({
      sprintKey: 'TEST-SPRINT-1',
      taskKey: 'TEST-1',
      actor: 'daniel',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.sprintId).not.toBeNull();

    const view = sprints.show('TEST-SPRINT-1');
    expect(view?.tasks.map((t) => t.key)).toEqual(['TEST-1']);

    const removed = sprints.removeTask({
      sprintKey: 'TEST-SPRINT-1',
      taskKey: 'TEST-1',
      actor: 'daniel',
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.sprintId).toBeNull();
  });

  it('exposes the active sprint for a project', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });
    expect(sprints.active('TEST')).toBeNull();

    sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    const active = sprints.active('TEST');
    expect(active?.sprint.key).toBe('TEST-SPRINT-1');
  });

  describe('plan payload validation', () => {
    it('rejects a non-ISO8601 startsAt', () => {
      const result = sprints.plan({
        projectKey: 'TEST',
        name: 'A',
        startsAt: 'tomorrow',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.SprintInvalidPayload);
    });

    it('rejects an endsAt before startsAt', () => {
      const result = sprints.plan({
        projectKey: 'TEST',
        name: 'A',
        startsAt: '2026-05-10',
        endsAt: '2026-05-01',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.SprintInvalidPayload);
    });

    it('rejects a capacity outside [1, 1000]', () => {
      for (const bad of [0, -3, 1500, 1.5]) {
        const result = sprints.plan({
          projectKey: 'TEST',
          name: 'A',
          capacity: bad,
          actor: 'daniel',
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe(ErrorCode.SprintInvalidPayload);
      }
    });

    it('accepts a valid payload with all bounds', () => {
      const result = sprints.plan({
        projectKey: 'TEST',
        name: 'A',
        startsAt: '2026-05-01',
        endsAt: '2026-05-15T18:00:00Z',
        capacity: 42,
        actor: 'daniel',
      });
      expect(result.ok).toBe(true);
    });
  });
});
