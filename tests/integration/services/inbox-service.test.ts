import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { DecisionStatus } from '@/domain/enums/decision-status.js';
import { TaskState } from '@/domain/enums/task-state.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { DecisionService } from '@/services/backlog/decision-service.js';
import { InboxService } from '@/services/backlog/inbox-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { NoteRepository } from '@/storage/sqlite/repositories/note-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('InboxService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let inbox: InboxService;
  let tasks: TaskRepository;
  let decisions: DecisionService;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-inbox-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const projects = new ProjectRepository(adapter);
    const project = projects.insert({ key: 'TEST', name: 'Test' });
    projectId = project.id;

    const actors = new ActorRepository(adapter);
    const identity = new IdentityService(actors);
    identity.ensureActor('daniel', ActorKind.Human);
    const actor = actors.findByHandle('daniel');
    if (actor === null) throw new Error('precondition: actor exists');
    actorId = actor.id;

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const decisionRepo = new DecisionRepository(adapter);
    tasks = new TaskRepository(adapter);
    const notes = new NoteRepository(adapter);
    decisions = new DecisionService(decisionRepo, projects, identity, audit, notes, tasks);

    const workflowPath = path.resolve('workflows/default.json');
    const stateMachine = new StateMachine(loadWorkflowFile(workflowPath));
    inbox = new InboxService(tasks, decisions, 'TEST', stateMachine, {
      staleAfterDays: 9999,
      slaDays: {},
      wipLimits: {},
    });
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function insertTask(key: string, state: TaskState): void {
    tasks.insert({ key, projectId, title: key, reporterId: actorId, state });
  }

  it('returns empty queues when no items need attention', () => {
    insertTask('TEST-1', TaskState.Draft);
    const view = inbox.view();
    expect(view.awaitingReview).toHaveLength(0);
    expect(view.blocked).toHaveLength(0);
    expect(view.pendingDecisions).toHaveLength(0);
  });

  it('lists tasks in IN_REVIEW under awaitingReview', () => {
    insertTask('TEST-1', TaskState.InReview);
    const view = inbox.view();
    expect(view.awaitingReview.map((t) => t.key)).toEqual(['TEST-1']);
  });

  it('lists BLOCKED tasks under blocked', () => {
    insertTask('TEST-1', TaskState.Blocked);
    const view = inbox.view();
    expect(view.blocked.map((t) => t.key)).toEqual(['TEST-1']);
  });

  it('lists proposed decisions under pendingDecisions and excludes accepted ones', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    decisions.record({ projectKey: 'TEST', title: 'Title B', decision: 'b', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });

    const view = inbox.view();
    expect(view.pendingDecisions.map((d) => d.key)).toEqual(['TEST-ADR-2']);
  });

  it('1.4 sweep: under `lean` workflow (no review/blocked features) returns empty review/blocked queues', () => {
    const leanMachine = new StateMachine(loadWorkflowFile(path.resolve('workflows/lean.json')));
    const leanInbox = new InboxService(tasks, decisions, 'TEST', leanMachine, {
      staleAfterDays: 9999,
      slaDays: {},
      wipLimits: {},
    });
    // Even if a task somehow has IN_REVIEW state, the inbox under lean
    // should not surface it — the concept does not exist for that workflow.
    insertTask('TEST-1', TaskState.InReview);
    insertTask('TEST-2', TaskState.Blocked);
    const view = leanInbox.view();
    expect(view.awaitingReview).toHaveLength(0);
    expect(view.blocked).toHaveLength(0);
  });

  it('view() reads the active task list once, not once per breach computation', () => {
    insertTask('TEST-1', TaskState.InReview);
    insertTask('TEST-2', TaskState.Draft);

    const lean = vi.spyOn(tasks, 'findActiveLean');
    const legacy = vi.spyOn(tasks, 'findAllActive');

    inbox.view();

    // One lean read powers both SLA and WIP; the full-parse read is gone.
    expect(lean).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();

    lean.mockRestore();
    legacy.mockRestore();
  });
});
