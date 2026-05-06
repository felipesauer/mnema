import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskState } from '@/domain/enums/task-state.js';
import { InboxService } from '@/services/inbox-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('InboxService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let inbox: InboxService;
  let tasks: TaskRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-inbox-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    adapter
      .getDatabase()
      .prepare("INSERT INTO projects (id, key, name) VALUES ('p1', 'TEST', 'Test')")
      .run();
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
    tasks = new TaskRepository(adapter);
    inbox = new InboxService(tasks);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns empty queues when no tasks need attention', () => {
    tasks.insert({ key: 'TEST-1', projectId: 'p1', title: 'A', reporterId: 'a1' });
    const view = inbox.view();
    expect(view.awaitingReview).toHaveLength(0);
    expect(view.blocked).toHaveLength(0);
  });

  it('lists tasks in IN_REVIEW under awaitingReview', () => {
    tasks.insert({
      key: 'TEST-1',
      projectId: 'p1',
      title: 'In review',
      reporterId: 'a1',
      state: TaskState.InReview,
    });
    const view = inbox.view();
    expect(view.awaitingReview.map((t) => t.key)).toEqual(['TEST-1']);
    expect(view.blocked).toHaveLength(0);
  });

  it('lists BLOCKED tasks under blocked', () => {
    tasks.insert({
      key: 'TEST-1',
      projectId: 'p1',
      title: 'Blocked',
      reporterId: 'a1',
      state: TaskState.Blocked,
    });
    const view = inbox.view();
    expect(view.awaitingReview).toHaveLength(0);
    expect(view.blocked.map((t) => t.key)).toEqual(['TEST-1']);
  });
});
