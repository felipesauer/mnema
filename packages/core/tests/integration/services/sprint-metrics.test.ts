import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { SprintService } from '@/services/backlog/sprint-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintMetricRepository } from '@/storage/sqlite/repositories/sprint-metric-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { mapSqliteError } from '@/storage/sqlite/sqlite-error-map.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('SprintService metrics', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let sprints: SprintService;
  let sprintRepo: SprintRepository;
  let projectId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-sm-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();

    sprintRepo = new SprintRepository(adapter);
    const stateMachine = new StateMachine(
      loadWorkflowFile(path.resolve('packages/core/workflows/default.json')),
    );
    sprints = new SprintService(
      sprintRepo,
      new TaskRepository(adapter),
      projects,
      audit,
      stateMachine,
      new SprintMetricRepository(adapter),
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeSprint(key: string): void {
    sprintRepo.insert({ projectId, key, name: key });
  }

  it('adds a metric with target and optional fields', () => {
    makeSprint('TEST-SPRINT-1');
    const result = sprints.addMetric({
      sprintKey: 'TEST-SPRINT-1',
      name: 'p95 latency',
      baseline: 800,
      target: 200,
      unit: 'ms',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('p95 latency');
    expect(result.value.target).toBe(200);
    expect(result.value.baseline).toBe(800);
    expect(result.value.unit).toBe('ms');
  });

  it('rejects a duplicate metric name on the same sprint', () => {
    makeSprint('TEST-SPRINT-1');
    sprints.addMetric({
      sprintKey: 'TEST-SPRINT-1',
      name: 'coverage',
      target: 80,
      actor: 'daniel',
    });
    const dup = sprints.addMetric({
      sprintKey: 'TEST-SPRINT-1',
      name: 'coverage',
      target: 90,
      actor: 'daniel',
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.kind).toBe(ErrorCode.SprintMetricDuplicate);
  });

  it('rejects metrics on an unknown sprint', () => {
    const result = sprints.addMetric({
      sprintKey: 'NOPE-SPRINT-9',
      name: 'x',
      target: 1,
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.SprintNotFound);
  });

  it('show() carries the metrics', () => {
    makeSprint('TEST-SPRINT-1');
    sprints.addMetric({ sprintKey: 'TEST-SPRINT-1', name: 'a', target: 1, actor: 'daniel' });
    sprints.addMetric({ sprintKey: 'TEST-SPRINT-1', name: 'b', target: 2, actor: 'daniel' });
    const view = sprints.show('TEST-SPRINT-1');
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.metrics).toHaveLength(2);
  });

  it('metricsFor returns the sprint metrics', () => {
    makeSprint('TEST-SPRINT-1');
    sprints.addMetric({ sprintKey: 'TEST-SPRINT-1', name: 'a', target: 1, actor: 'daniel' });
    const result = sprints.metricsFor('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe('a');
  });

  it('maps a UNIQUE(sprint_id, name) race to a structured duplicate', () => {
    makeSprint('TEST-SPRINT-1');
    const sprintId = sprintRepo.findByKey('TEST-SPRINT-1')?.id;
    expect(sprintId).toBeDefined();
    const metricRepo = new SprintMetricRepository(adapter);
    metricRepo.insert({ sprintId: sprintId as string, name: 'coverage', target: 1 });

    // A second writer that passed the service-level exists() check would lose
    // this race at the DB. mapSqliteError must translate the raw UNIQUE
    // violation into SprintMetricDuplicate rather than letting it escape.
    let mapped: ErrorCode | 'threw-unmapped' | 'no-throw' = 'no-throw';
    try {
      metricRepo.insert({ sprintId: sprintId as string, name: 'coverage', target: 2 });
    } catch (error) {
      const m = mapSqliteError(error);
      mapped = m === null ? 'threw-unmapped' : m.kind;
    }
    expect(mapped).toBe(ErrorCode.SprintMetricDuplicate);
  });
});
