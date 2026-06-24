import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateUuid } from '@/domain/id-generator.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditQuery } from '@/services/audit-query.js';
import { AuditService } from '@/services/audit-service.js';
import { WorkGraphLintService } from '@/services/work-graph-lint-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('WorkGraphLintService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let lint: WorkGraphLintService;
  let audit: AuditService;
  let sprints: SprintRepository;
  let epics: EpicRepository;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-wglint-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const auditDir = path.join(tempRoot, '.audit');
    audit = new AuditService(new AuditWriter(auditDir));
    const auditQuery = new AuditQuery(auditDir);

    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);

    sprints = new SprintRepository(adapter);
    epics = new EpicRepository(adapter);
    tasks = new TaskRepository(adapter);
    const stateMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
    );
    lint = new WorkGraphLintService(sprints, epics, tasks, stateMachine, auditQuery, adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTask(key: string, state = 'DRAFT', sprintId?: string): string {
    const task = tasks.insert({ key, projectId, title: key, reporterId: actorId, sprintId });
    if (state !== 'DRAFT') tasks.updateState(task.id, state);
    return task.id;
  }

  it('reports clean for a sprint whose tasks are all terminal (with an agent run)', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    makeTask('TEST-1', 'DONE', sprint.id);
    // a transition recorded under an agent run → not a bypass
    audit.write({
      kind: 'task_transitioned',
      actor: 'daniel',
      run: generateUuid(),
      data: { key: 'TEST-1', from: 'IN_REVIEW', to: 'DONE', action: 'approve' },
    });

    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toEqual([]);
    expect(result.value.errorCount).toBe(0);
  });

  it('warns about an empty sprint', () => {
    sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.some((d) => d.rule === 'empty')).toBe(true);
  });

  it('warns about non-terminal tasks', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    makeTask('TEST-1', 'IN_PROGRESS', sprint.id);
    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.value.diagnostics.find((x) => x.rule === 'incomplete-tasks');
    expect(d).toBeDefined();
    expect(d?.message).toContain('TEST-1');
  });

  it('flags subagent-bypass: a DONE task with audit events but none under a run', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    makeTask('TEST-1', 'DONE', sprint.id);
    // transition recorded WITHOUT a run id → bypass
    audit.write({
      kind: 'task_transitioned',
      actor: 'daniel',
      data: { key: 'TEST-1', from: 'IN_REVIEW', to: 'DONE', action: 'approve' },
    });

    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.some((d) => d.rule === 'subagent-bypass')).toBe(true);
  });

  it('does not flag bypass when a DONE task has no audit trail at all', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    makeTask('TEST-1', 'DONE', sprint.id);
    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.some((d) => d.rule === 'subagent-bypass')).toBe(false);
  });

  it('flags a broken dependency (blocker soft-deleted)', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    const dependent = makeTask('TEST-1', 'READY', sprint.id);
    const blocker = makeTask('TEST-2', 'DONE', sprint.id);
    // create a dependency edge directly (migration-001 table)
    adapter
      .getDatabase()
      .prepare(
        "INSERT INTO dependencies (id, task_id, blocks_task_id, kind, created_at) VALUES (?, ?, ?, 'blocks', ?)",
      )
      .run(generateUuid(), dependent, blocker, '2026-06-23T00:00:00.000Z');
    // soft-delete the blocker → edge is now broken
    adapter
      .getDatabase()
      .prepare("UPDATE tasks SET deleted_at = '2026-06-23T01:00:00.000Z' WHERE id = ?")
      .run(blocker);

    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const broken = result.value.diagnostics.find((d) => d.rule === 'broken-dependency');
    expect(broken).toBeDefined();
    expect(broken?.severity).toBe('error');
    expect(result.value.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('lints an epic and warns when empty', () => {
    epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    const result = lint.lintEpic('TEST-EPIC-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.some((d) => d.rule === 'empty')).toBe(true);
  });

  it('returns SprintNotFound / EpicNotFound for unknown keys', () => {
    const s = lint.lintSprint('NOPE-SPRINT-9');
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.kind).toBe(ErrorCode.SprintNotFound);

    const e = lint.lintEpic('NOPE-EPIC-9');
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error.kind).toBe(ErrorCode.EpicNotFound);
  });

  it('flags subagent-bypass even when a run-carrying non-transition event is present', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    makeTask('TEST-1', 'DONE', sprint.id);
    // The DONE transition was NOT run-tracked → a genuine bypass.
    audit.write({
      kind: 'task_transitioned',
      actor: 'daniel',
      data: { key: 'TEST-1', from: 'IN_REVIEW', to: 'DONE', action: 'approve' },
    });
    // …but a note WAS written under a run. This must not mask the bypass.
    audit.write({
      kind: 'note_added',
      actor: 'daniel',
      run: generateUuid(),
      data: { task_key: 'TEST-1', note_kind: 'comment', content_size: 3 },
    });

    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.some((d) => d.rule === 'subagent-bypass')).toBe(true);
  });

  it('does not report an informational (relates_to) edge to a deleted task as broken', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    const a = makeTask('TEST-1', 'DONE', sprint.id);
    const b = makeTask('TEST-2', 'DONE', sprint.id);
    // run-tracked transitions so the only candidate diagnostic is the edge
    for (const key of ['TEST-1', 'TEST-2']) {
      audit.write({
        kind: 'task_transitioned',
        actor: 'daniel',
        run: generateUuid(),
        data: { key, from: 'IN_REVIEW', to: 'DONE', action: 'approve' },
      });
    }
    adapter
      .getDatabase()
      .prepare(
        "INSERT INTO dependencies (id, task_id, blocks_task_id, kind, created_at) VALUES (?, ?, ?, 'relates_to', '2026-06-23T00:00:00.000Z')",
      )
      .run(generateUuid(), a, b);
    tasks.softDelete(b);

    const result = lint.lintSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics.some((d) => d.rule === 'broken-dependency')).toBe(false);
    expect(result.value.errorCount).toBe(0);
  });
});
