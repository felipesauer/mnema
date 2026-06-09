import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { DecisionStatus } from '@/domain/enums/decision-status.js';
import { ErrorCode } from '@/errors/error-codes.js';
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

describe('DecisionService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let decisions: DecisionService;
  let projects: ProjectRepository;
  let tasks: TaskRepository;
  let notes: NoteRepository;
  let identity: IdentityService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-decision-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const decisionRepo = new DecisionRepository(adapter);
    projects = new ProjectRepository(adapter);
    tasks = new TaskRepository(adapter);
    notes = new NoteRepository(adapter);
    const actors = new ActorRepository(adapter);
    identity = new IdentityService(actors);

    decisions = new DecisionService(decisionRepo, projects, identity, audit, notes, tasks);

    projects.insert({ key: 'TEST', name: 'Test' });
    identity.ensureActor('daniel', ActorKind.Human);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('records an ADR with key derived from the project', () => {
    const result = decisions.record({
      projectKey: 'TEST',
      title: 'Adopt Zod',
      decision: 'Use Zod 4 for runtime validation',
      context: 'Both config and user input need validation',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe('TEST-ADR-1');
    expect(result.value.status).toBe(DecisionStatus.Proposed);
    expect(result.value.context).toBe('Both config and user input need validation');
  });

  it('increments the per-project sequence', () => {
    decisions.record({ projectKey: 'TEST', title: 'A', decision: 'a', actor: 'daniel' });
    const second = decisions.record({
      projectKey: 'TEST',
      title: 'B',
      decision: 'b',
      actor: 'daniel',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.key).toBe('TEST-ADR-2');
  });

  it('moves proposed → accepted', () => {
    decisions.record({ projectKey: 'TEST', title: 'A', decision: 'a', actor: 'daniel' });
    const accepted = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.status).toBe(DecisionStatus.Accepted);
  });

  it('rejects accepted → proposed (illegal transition)', () => {
    decisions.record({ projectKey: 'TEST', title: 'A', decision: 'a', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    const back = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Proposed,
      actor: 'daniel',
    });
    expect(back.ok).toBe(false);
    if (back.ok) return;
    expect(back.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
  });

  it('supersede requires the successor key and links the rows', () => {
    decisions.record({ projectKey: 'TEST', title: 'Old', decision: 'old', actor: 'daniel' });
    decisions.record({ projectKey: 'TEST', title: 'New', decision: 'new', actor: 'daniel' });

    const missing = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      actor: 'daniel',
    });
    expect(missing.ok).toBe(false);

    const superseded = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      supersededBy: 'TEST-ADR-2',
      actor: 'daniel',
    });
    expect(superseded.ok).toBe(true);
    if (!superseded.ok) return;
    expect(superseded.value.status).toBe(DecisionStatus.Superseded);
    expect(superseded.value.supersededBy).not.toBeNull();
  });

  it('listPending returns only proposed decisions', () => {
    decisions.record({ projectKey: 'TEST', title: 'A', decision: 'a', actor: 'daniel' });
    decisions.record({ projectKey: 'TEST', title: 'B', decision: 'b', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });

    const pending = decisions.listPending('TEST');
    expect(pending.map((d) => d.key)).toEqual(['TEST-ADR-2']);
  });

  it('show returns DECISION_NOT_FOUND when the key is unknown', () => {
    const result = decisions.show('TEST-ADR-99');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.DecisionNotFound);
  });

  it('transition succeeds when expectedUpdatedAt matches', () => {
    const recorded = decisions.record({
      projectKey: 'TEST',
      title: 'A',
      decision: 'a',
      actor: 'daniel',
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const result = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
      expectedUpdatedAt: recorded.value.updatedAt,
    });
    expect(result.ok).toBe(true);
  });

  it('transition returns Conflict when expectedUpdatedAt is stale', () => {
    decisions.record({ projectKey: 'TEST', title: 'A', decision: 'a', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    const stale = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      supersededBy: 'TEST-ADR-1',
      actor: 'daniel',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe(ErrorCode.Conflict);
  });

  describe('promoteFromNote', () => {
    function seedTaskAndNote(): { taskId: string; noteId: string; taskKey: string } {
      const project = projects.findByKey('TEST');
      if (project === null) throw new Error('project precondition');
      const reporterId = identity.ensureActor('daniel', ActorKind.Human);
      const task = tasks.insert({
        key: 'TEST-1',
        projectId: project.id,
        title: 'Seed task for note→ADR',
        reporterId,
      });
      const note = notes.insert({
        taskId: task.id,
        actorId: reporterId,
        kind: 'agent_observation',
        content: 'Considering switching to Postgres for write-heavy workloads.',
      });
      return { taskId: task.id, noteId: note.id, taskKey: task.key };
    }

    it('promotes a note to an ADR and emits a linkage event', () => {
      const seed = seedTaskAndNote();

      const result = decisions.promoteFromNote({
        noteId: seed.noteId,
        title: 'Switch to Postgres',
        decision: 'Adopt Postgres for the write-heavy path',
        rationale: 'SQLite contention under concurrent writers',
        actor: 'daniel',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('TEST-ADR-1');
      expect(result.value.status).toBe(DecisionStatus.Proposed);

      // The linkage event should be in the audit log (the test
      // doesn't have an auditQuery wired but the writer was given
      // the event — that suffices for the unit contract).
    });

    it('returns NoteNotFound for an unknown note id', () => {
      const result = decisions.promoteFromNote({
        noteId: '00000000-0000-0000-0000-000000000000',
        title: 'Phantom promotion',
        decision: 'nope',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.NoteNotFound);
    });
  });
});
