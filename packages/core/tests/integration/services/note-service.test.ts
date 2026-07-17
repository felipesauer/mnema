import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { NoteService } from '@/services/backlog/note-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { NoteRepository } from '@/storage/sqlite/repositories/note-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('NoteService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let notes: NoteService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-note-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    const project = projects.insert({ key: 'TEST', name: 'Test' });

    const actors = new ActorRepository(adapter);
    const identity = new IdentityService(actors);
    identity.ensureActor('daniel', ActorKind.Human);
    const actor = actors.findByHandle('daniel');
    if (actor === null) throw new Error('precondition: actor exists');

    const tasks = new TaskRepository(adapter);
    tasks.insert({ key: 'TEST-1', projectId: project.id, title: 'A', reporterId: actor.id });

    notes = new NoteService(new NoteRepository(adapter), tasks, identity, audit);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('adds a comment to a task by default', () => {
    const result = notes.add({
      taskKey: 'TEST-1',
      kind: 'comment',
      content: 'looks good to me',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('comment');
    expect(result.value.content).toBe('looks good to me');
  });

  it('honours non-default kinds (agent_observation)', () => {
    const result = notes.add({
      taskKey: 'TEST-1',
      kind: 'agent_observation',
      content: 'spotted a regression in the cart total',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('agent_observation');
  });

  it('returns TASK_NOT_FOUND for an unknown task key', () => {
    const result = notes.add({
      taskKey: 'GHOST-1',
      kind: 'comment',
      content: 'orphan',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('lists notes ordered by record time and supports kind filter', () => {
    notes.add({ taskKey: 'TEST-1', kind: 'comment', content: 'first', actor: 'daniel' });
    notes.add({
      taskKey: 'TEST-1',
      kind: 'agent_observation',
      content: 'middle',
      actor: 'daniel',
    });
    notes.add({ taskKey: 'TEST-1', kind: 'comment', content: 'last', actor: 'daniel' });

    const all = notes.listForTask('TEST-1');
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value.map((n) => n.content)).toEqual(['first', 'middle', 'last']);

    const onlyComments = notes.listForTask('TEST-1', 'comment');
    expect(onlyComments.ok).toBe(true);
    if (!onlyComments.ok) return;
    expect(onlyComments.value.map((n) => n.content)).toEqual(['first', 'last']);
  });
});
