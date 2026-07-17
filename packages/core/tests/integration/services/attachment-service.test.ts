import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AttachmentService } from '@/services/attachment-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { FileStore } from '@/storage/files/file-store.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { AttachmentRepository } from '@/storage/sqlite/repositories/attachment-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('AttachmentService + FileStore', () => {
  let tempRoot: string;
  let attachmentsDir: string;
  let adapter: SqliteAdapter;
  let service: AttachmentService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attach-svc-'));
    attachmentsDir = path.join(tempRoot, '.app', 'attachments');
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const actors = new ActorRepository(adapter);
    const projects = new ProjectRepository(adapter);
    const tasks = new TaskRepository(adapter);
    const repository = new AttachmentRepository(adapter);
    const decisionRepository = new DecisionRepository(adapter);
    const fileStore = new FileStore(attachmentsDir);
    const identity = new IdentityService(actors);

    service = new AttachmentService(
      repository,
      tasks,
      decisionRepository,
      fileStore,
      identity,
      audit,
      attachmentsDir,
    );

    const project = projects.insert({ key: 'TEST', name: 'Test' });
    const reporterId = actors.upsert('daniel', ActorKind.Human);
    tasks.insert({
      key: 'TEST-1',
      projectId: project.id,
      title: 'A',
      reporterId,
    });
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('stores a new file under attachments and records metadata', () => {
    const source = path.join(tempRoot, 'note.txt');
    writeFileSync(source, 'hello attachments\n', 'utf-8');

    const result = service.attachToTask({
      taskKey: 'TEST-1',
      sourcePath: source,
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filename).toBe('note.txt');
    expect(result.value.mime).toBe('text/plain');
    expect(result.value.size).toBeGreaterThan(0);
    expect(existsSync(attachmentsDir)).toBe(true);
    const stored = readdirSync(attachmentsDir);
    expect(stored).toHaveLength(1);
  });

  it('deduplicates identical content (same hash)', () => {
    const source1 = path.join(tempRoot, 'a.txt');
    const source2 = path.join(tempRoot, 'b.txt');
    writeFileSync(source1, 'identical\n', 'utf-8');
    writeFileSync(source2, 'identical\n', 'utf-8');

    const first = service.attachToTask({ taskKey: 'TEST-1', sourcePath: source1, actor: 'daniel' });
    const second = service.attachToTask({
      taskKey: 'TEST-1',
      sourcePath: source2,
      actor: 'daniel',
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.hash).toBe(second.value.hash);

    const stored = readdirSync(attachmentsDir);
    expect(stored).toHaveLength(1);
  });

  it('returns ATTACHMENT_SOURCE_NOT_FOUND when source is missing', () => {
    const result = service.attachToTask({
      taskKey: 'TEST-1',
      sourcePath: path.join(tempRoot, 'missing.txt'),
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.AttachmentSourceNotFound);
  });

  it('returns TASK_NOT_FOUND when target task does not exist', () => {
    const source = path.join(tempRoot, 'note.txt');
    writeFileSync(source, 'noop\n', 'utf-8');

    const result = service.attachToTask({
      taskKey: 'GHOST-1',
      sourcePath: source,
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('listForTask returns attachments in order and respects unknown task', () => {
    const source = path.join(tempRoot, 'note.txt');
    writeFileSync(source, 'first\n', 'utf-8');
    service.attachToTask({ taskKey: 'TEST-1', sourcePath: source, actor: 'daniel' });

    const list = service.listForTask('TEST-1');
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);

    const ghost = service.listForTask('GHOST');
    expect(ghost.ok).toBe(false);
  });

  it('attaching the same content to the same task twice does not duplicate the row', () => {
    const source = path.join(tempRoot, 'dup.txt');
    writeFileSync(source, 'identical body\n', 'utf-8');
    const first = service.attachToTask({
      taskKey: 'TEST-1',
      sourcePath: source,
      actor: 'daniel',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = service.attachToTask({
      taskKey: 'TEST-1',
      sourcePath: source,
      actor: 'daniel',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Same row id returned both times.
    expect(second.value.id).toBe(first.value.id);

    const list = service.listForTask('TEST-1');
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);
  });

  it('persists the bare filename in `path` (not a baked-in prefix)', () => {
    const source = path.join(tempRoot, 'paths.bin');
    writeFileSync(source, 'paths\n', 'utf-8');
    const result = service.attachToTask({
      taskKey: 'TEST-1',
      sourcePath: source,
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Just the `{hash}.bin` filename, no leading `.app/attachments/`.
    expect(result.value.path).not.toContain('/');
    expect(result.value.path).toMatch(/^[0-9a-f]{64}\.bin$/);
  });
});
