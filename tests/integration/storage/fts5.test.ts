import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('FTS5 search', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-fts-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const db = adapter.getDatabase();
    db.prepare("INSERT INTO projects (id, key, name) VALUES ('p1', 'WEBAPP', 'Test')").run();
    db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')").run();

    db.prepare(
      `INSERT INTO tasks (id, key, project_id, title, description, reporter_id)
       VALUES
         ('t1', 'WEBAPP-1', 'p1', 'Implement OAuth login',
            'Add support for Google OAuth flow',           'a1'),
         ('t2', 'WEBAPP-2', 'p1', 'Refatorar autenticação',
            'Reescrever a camada de sessão para o app',    'a1'),
         ('t3', 'WEBAPP-3', 'p1', 'Fix login redirect',
            'Users are bounced back to home',              'a1')`,
    ).run();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('finds rows by exact word in the title', () => {
    const rows = adapter
      .getDatabase()
      .prepare("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH 'login' ORDER BY task_id")
      .all() as Array<{ task_id: string }>;
    expect(rows.map((r) => r.task_id)).toEqual(['t1', 't3']);
  });

  it('matches diacritics insensitively (remove_diacritics 2)', () => {
    const rows = adapter
      .getDatabase()
      .prepare("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH 'autenticacao'")
      .all() as Array<{ task_id: string }>;
    expect(rows.map((r) => r.task_id)).toContain('t2');
  });

  it('reflects updates via the AFTER UPDATE trigger', () => {
    const db = adapter.getDatabase();
    db.prepare("UPDATE tasks SET title = 'Improved OAuth login' WHERE id = 't1'").run();

    const rows = db
      .prepare("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH 'improved'")
      .all() as Array<{ task_id: string }>;
    expect(rows.map((r) => r.task_id)).toEqual(['t1']);
  });

  it('removes rows from the FTS index on hard delete', () => {
    const db = adapter.getDatabase();
    db.prepare("DELETE FROM tasks WHERE id = 't1'").run();

    const rows = db
      .prepare("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH 'oauth'")
      .all() as Array<{ task_id: string }>;
    expect(rows.map((r) => r.task_id)).not.toContain('t1');
  });
});
