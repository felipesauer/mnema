import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { AttachmentService } from '@/services/attachment-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { FileStore } from '@/storage/files/file-store.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { AttachmentRepository } from '@/storage/sqlite/repositories/attachment-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('attachment GC (orphan reclamation)', () => {
  let tempRoot: string;
  let attachmentsDir: string;
  let adapter: SqliteAdapter;
  let repository: AttachmentRepository;
  let service: AttachmentService;
  let taskId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attach-gc-'));
    attachmentsDir = path.join(tempRoot, '.app', 'attachments');
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const actors = new ActorRepository(adapter);
    const projects = new ProjectRepository(adapter);
    const tasks = new TaskRepository(adapter);
    repository = new AttachmentRepository(adapter);
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
    taskId = tasks.insert({ projectId: project.id, title: 'A', reporterId }).id;
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Attaches `content` to the fixture task and returns the persisted attachment row. */
  function attach(name: string, content: string) {
    const source = path.join(tempRoot, name);
    writeFileSync(source, content, 'utf-8');
    const result = service.attachToTask({ taskKey: taskId, sourcePath: source, actor: 'daniel' });
    if (!result.ok) throw new Error(`attach failed: ${result.error.kind}`);
    return result.value;
  }

  /** Soft-deletes the attachment row(s) whose `path` matches `filename`. */
  function softDeleteByPath(filename: string): void {
    adapter
      .getDatabase()
      .prepare("UPDATE attachments SET deleted_at = datetime('now') WHERE path = ?")
      .run(filename);
  }

  it('removes a true orphan file (no row references it)', () => {
    // A stray blob with no matching row — the shape GC exists to reclaim.
    mkdirSync(attachmentsDir, { recursive: true });
    const orphan = 'deadbeef.bin';
    writeFileSync(path.join(attachmentsDir, orphan), 'stray bytes\n', 'utf-8');

    const result = service.gcOrphans({ dryRun: false });

    expect(result.removed).toBe(true);
    expect(result.orphans).toEqual([orphan]);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(existsSync(path.join(attachmentsDir, orphan))).toBe(false);
  });

  it('keeps a blob referenced by a LIVE row', () => {
    const kept = attach('live.txt', 'live content\n').path;

    const result = service.gcOrphans({ dryRun: false });

    expect(result.orphans).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(existsSync(path.join(attachmentsDir, kept))).toBe(true);
  });

  it('keeps a blob referenced ONLY by a soft-deleted row', () => {
    // A soft-deleted row still protects its blob (no undo exists yet, but a
    // future restore must not find it gone) — so GC must not reclaim it.
    const kept = attach('soft.txt', 'soft-deleted content\n').path;
    softDeleteByPath(kept);

    const result = service.gcOrphans({ dryRun: false });

    expect(result.orphans).toEqual([]);
    expect(existsSync(path.join(attachmentsDir, kept))).toBe(true);
  });

  it('keeps a blob shared by two rows when only one is soft-deleted', () => {
    // One materialised blob referenced by two rows. `attach` writes the file
    // and the first row; a second row is inserted straight into the table
    // pointing at the SAME filename (a distinct parent). Soft-delete one of
    // the two, and the blob is still protected by the other — dedup safety.
    const first = attach('dup-a.txt', 'shared body\n');
    repository.insert({
      parentKind: 'task',
      parentId: 'second-parent-id',
      filename: 'dup-b.txt',
      path: first.path,
      mime: first.mime,
      size: first.size,
      hash: first.hash,
      uploadedBy: first.uploadedBy,
    });
    // Soft-delete exactly the first row, leaving the second one live.
    adapter
      .getDatabase()
      .prepare("UPDATE attachments SET deleted_at = datetime('now') WHERE id = ?")
      .run(first.id);

    const result = service.gcOrphans({ dryRun: false });

    expect(result.orphans).toEqual([]);
    expect(existsSync(path.join(attachmentsDir, first.path))).toBe(true);
  });

  it('dry run reports the orphan and its bytes but deletes nothing', () => {
    mkdirSync(attachmentsDir, { recursive: true });
    const orphan = 'cafef00d.bin';
    const body = 'dry-run bytes\n';
    writeFileSync(path.join(attachmentsDir, orphan), body, 'utf-8');

    const result = service.gcOrphans({ dryRun: true });

    expect(result.removed).toBe(false);
    expect(result.orphans).toEqual([orphan]);
    expect(result.freedBytes).toBe(Buffer.byteLength(body));
    // Nothing removed.
    expect(existsSync(path.join(attachmentsDir, orphan))).toBe(true);
    expect(readdirSync(attachmentsDir)).toContain(orphan);
  });

  it('returns an empty result when the attachments directory is missing', () => {
    // Fresh service pointed at a dir that was never created.
    const emptyResult = service.gcOrphans({ dryRun: true });
    // (attachmentsDir does not exist yet — no attach happened in this test)
    expect(existsSync(attachmentsDir)).toBe(false);
    expect(emptyResult.orphans).toEqual([]);
    expect(emptyResult.freedBytes).toBe(0);
  });
});
