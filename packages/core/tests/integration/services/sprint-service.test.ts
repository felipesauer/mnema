import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SprintState } from '@/domain/enums/sprint-state.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { SprintService } from '@/services/backlog/sprint-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintMetricRepository } from '@/storage/sqlite/repositories/sprint-metric-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

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
    const stateMachine = new StateMachine(
      loadWorkflowFile(path.resolve('packages/core/workflows/default.json')),
    );

    sprints = new SprintService(
      sprintRepo,
      tasks,
      projects,
      audit,
      stateMachine,
      new SprintMetricRepository(adapter),
    );

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

  it('cancels a planned sprint (retire without completing) and stamps closed_at', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });

    const canceled = sprints.cancel({
      sprintKey: 'TEST-SPRINT-1',
      reason: 'superseded; tasks delivered elsewhere',
      actor: 'daniel',
    });
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(canceled.value.state).toBe(SprintState.Canceled);
    expect(canceled.value.closedAt).not.toBeNull();
  });

  it('cancels an active sprint too', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });
    sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    const canceled = sprints.cancel({
      sprintKey: 'TEST-SPRINT-1',
      reason: 'abandoned',
      actor: 'daniel',
    });
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(canceled.value.state).toBe(SprintState.Canceled);
    // A canceled sprint is not the active one — a new sprint can start.
    sprints.plan({ projectKey: 'TEST', name: 'B', actor: 'daniel' });
    expect(sprints.start({ sprintKey: 'TEST-SPRINT-2', actor: 'daniel' }).ok).toBe(true);
  });

  it('rejects cancel on a closed sprint and requires a reason', () => {
    sprints.plan({ projectKey: 'TEST', name: 'A', actor: 'daniel' });
    sprints.start({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });
    sprints.close({ sprintKey: 'TEST-SPRINT-1', actor: 'daniel' });

    const onClosed = sprints.cancel({
      sprintKey: 'TEST-SPRINT-1',
      reason: 'too late',
      actor: 'daniel',
    });
    expect(onClosed.ok).toBe(false);
    if (onClosed.ok) return;
    expect(onClosed.error.kind).toBe(ErrorCode.SprintInvalidState);

    sprints.plan({ projectKey: 'TEST', name: 'B', actor: 'daniel' });
    const noReason = sprints.cancel({ sprintKey: 'TEST-SPRINT-2', reason: '  ', actor: 'daniel' });
    expect(noReason.ok).toBe(false);
    if (noReason.ok) return;
    expect(noReason.error.kind).toBe(ErrorCode.ValidationFailed);
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

  describe('optimistic concurrency on start/close', () => {
    it('start succeeds with the matching expectedUpdatedAt', () => {
      const planned = sprints.plan({
        projectKey: 'TEST',
        name: 'C3 start',
        actor: 'daniel',
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const started = sprints.start({
        sprintKey: planned.value.key,
        actor: 'daniel',
        expectedUpdatedAt: planned.value.updatedAt,
      });
      expect(started.ok).toBe(true);
    });

    it('start returns Conflict when expectedUpdatedAt is stale', () => {
      const planned = sprints.plan({
        projectKey: 'TEST',
        name: 'C3 stale',
        actor: 'daniel',
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const stale = sprints.start({
        sprintKey: planned.value.key,
        actor: 'daniel',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      });
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.error.kind).toBe(ErrorCode.Conflict);
    });
  });

  describe('features.sprints enforcement', () => {
    it('refuses to plan a sprint on a workflow that declares features.sprints=false', () => {
      const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit-kanban')));
      const kanbanMachine = new StateMachine(
        loadWorkflowFile(path.resolve('packages/core/tests/fixtures/workflows/kanban.json')),
      );
      const sprintsKanban = new SprintService(
        new SprintRepository(adapter),
        tasks,
        projects,
        audit,
        kanbanMachine,
        new SprintMetricRepository(adapter),
      );
      const result = sprintsKanban.plan({
        projectKey: 'TEST',
        name: 'should-fail',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.FeatureNotAvailable);
      if (result.error.kind !== ErrorCode.FeatureNotAvailable) return;
      expect(result.error.feature).toBe('sprints');
      expect(result.error.workflow).toBe('kanban');
    });
  });
});
