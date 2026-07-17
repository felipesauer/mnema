import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireFreshSchema } from '@/mcp/mcp-tool-result.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * A long-lived MCP server caches nothing that would keep it blocked after a
 * `mnema migrate` in another process: mutating tools re-detect drift at call
 * time via a thunk. This proves the thunk lifts (and re-raises) the block
 * against a live DB without reconstructing anything.
 */
describe('schema drift re-detection (MCP unblock without restart)', () => {
  let tempRoot: string;
  let dbPath: string;
  let serverAdapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-redetect-'));
    dbPath = path.join(tempRoot, 'state.db');
  });

  afterEach(() => {
    serverAdapter?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('lifts SCHEMA_OUT_OF_DATE after another connection applies the migration', () => {
    const runner = new MigrationRunner();
    // The runner walks exactly ONE directory, so the scenario stages a
    // writable copy of the bundled set: the server boots against it fully
    // applied, then a future migration "lands" in the same directory (a
    // `git pull` bringing a schema bump) that the server has not applied.
    const sources = path.join(tempRoot, 'bundled-migrations');
    mkdirSync(sources, { recursive: true });
    for (const file of readdirSync(migrationsDir)) {
      copyFileSync(path.join(migrationsDir, file), path.join(sources, file));
    }
    serverAdapter = new SqliteAdapter(dbPath);
    runner.run(serverAdapter, sources);

    const futureSql =
      'CREATE TABLE redetect_probe (id INTEGER PRIMARY KEY);\n' +
      "INSERT INTO schema_migrations (version, applied_at) VALUES (999, strftime('%Y-%m-%dT%H:%M:%fZ','now'));\n";
    writeFileSync(path.join(sources, '999_redetect_probe.sql'), futureSql);

    // The server's re-detect thunk (what the MCP tools call each mutation).
    const detect = (): readonly string[] =>
      runner.detectDrift(serverAdapter, sources).map((m) => m.file);

    // Blocked now: the future migration is pending, mutation refused.
    expect(detect()).toEqual(['999_redetect_probe.sql']);
    expect(requireFreshSchema(detect)).not.toBeNull();

    // ANOTHER process (a separate adapter on the same file) runs `migrate`.
    const cliAdapter = new SqliteAdapter(dbPath);
    runner.run(cliAdapter, sources);
    cliAdapter.close();

    // The SAME server adapter, re-detecting, now sees no drift → unblocked,
    // with NO restart and NO new container.
    expect(detect().length).toBe(0);
    expect(requireFreshSchema(detect)).toBeNull();
  });

  it('requireFreshSchema accepts a thunk and re-evaluates it each call', () => {
    let pending: string[] = ['025_future.sql'];
    const thunk = (): readonly string[] => pending;
    expect(requireFreshSchema(thunk)).not.toBeNull(); // blocked
    pending = []; // migration applied elsewhere
    expect(requireFreshSchema(thunk)).toBeNull(); // re-evaluated → unblocked
  });

  it('still accepts a fixed array (CLI path, fresh container per call)', () => {
    expect(requireFreshSchema([])).toBeNull();
    expect(requireFreshSchema(['025_future.sql'])).not.toBeNull();
  });
});
