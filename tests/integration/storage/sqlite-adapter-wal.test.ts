import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * On a long-lived connection (the `mnema mcp serve` daemon), the `-wal` grows
 * to the high-water mark of its largest write burst and stays there while the
 * connection is open — a passive autocheckpoint recycles frames in place but
 * doesn't shrink the file. `checkpointTruncate()` reclaims it WHILE OPEN, which
 * is what the daemon calls periodically. (A short-lived CLI `close()` empties
 * the `-wal` on its own, so the value is specifically for the open-connection
 * case exercised here.)
 */
describe('SqliteAdapter.checkpointTruncate', () => {
  let tempRoot: string;
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-wal-'));
    dbPath = path.join(tempRoot, 'state.db');
    adapter = new SqliteAdapter(dbPath);
    new MigrationRunner().run(adapter, migrationsDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const walSize = () => {
    const wal = `${dbPath}-wal`;
    return existsSync(wal) ? statSync(wal).size : 0;
  };

  /** Inflates the WAL with a burst of writes on a scratch table. */
  function inflateWal(): void {
    const db = adapter.getDatabase();
    db.exec('CREATE TABLE IF NOT EXISTS scratch (id INTEGER PRIMARY KEY, blob TEXT)');
    const insert = db.prepare('INSERT INTO scratch (blob) VALUES (?)');
    const payload = 'x'.repeat(4096);
    db.transaction(() => {
      for (let i = 0; i < 2000; i += 1) insert.run(payload);
    })();
  }

  it('shrinks the open -wal back to zero (the daemon high-water case)', () => {
    inflateWal();
    // The burst leaves a sizeable WAL on the still-open connection.
    expect(walSize()).toBeGreaterThan(64 * 1024);

    adapter.checkpointTruncate();

    expect(walSize()).toBe(0);
  });

  it('is a safe no-op on an idle connection (nothing to reclaim)', () => {
    expect(() => adapter.checkpointTruncate()).not.toThrow();
    expect(walSize()).toBe(0);
  });

  it('does not lose data — rows remain after the checkpoint', () => {
    inflateWal();
    adapter.checkpointTruncate();
    const row = adapter.getDatabase().prepare('SELECT COUNT(*) AS n FROM scratch').get() as {
      n: number;
    };
    expect(row.n).toBe(2000);
  });
});
