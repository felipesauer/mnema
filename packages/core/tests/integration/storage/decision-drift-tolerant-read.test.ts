import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

/**
 * A read that worked before an additive migration must not start throwing
 * once the migration ships but has not yet been applied. Migration 015 adds
 * `decisions.impacts`; on a DB stopped at 014 `SELECT *` yields no `impacts`
 * column, and `rowToDecision` used to call `JSON.parse(undefined)` and crash
 * every decision read (decision_show / decisions_list / decisions_impacting).
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/** Builds a temp migrations dir containing only files numbered <= maxVersion. */
function migrationsUpTo(maxVersion: number): string {
  const dst = mkdtempSync(path.join(tmpdir(), 'mnema-mig-subset-'));
  for (const file of readdirSync(migrationsDir)) {
    const version = Number(file.slice(0, 3));
    if (Number.isInteger(version) && version <= maxVersion) {
      copyFileSync(path.join(migrationsDir, file), path.join(dst, file));
    }
  }
  return dst;
}

describe('decision reads are drift-tolerant before migration 015', () => {
  let tempRoot: string;
  let subsetDir: string;
  let adapter: SqliteAdapter;
  let decisions: DecisionRepository;
  let projectId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-drift-'));
    subsetDir = migrationsUpTo(14); // pre-015: no `impacts` column
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, subsetDir);

    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
    // Insert a decision row directly — no impacts column exists yet.
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO decisions
          (id, key, project_id, title, decision, status, authored_by, metadata, at, updated_at)
         VALUES ('d1', 'TEST-ADR-1', ?, 'A title', 'do x', 'proposed', 'a1', '{}',
                 '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z')`,
      )
      .run(projectId);
    decisions = new DecisionRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(subsetDir, { recursive: true, force: true });
  });

  it('findByKey returns the row with impacts defaulting to [] instead of throwing', () => {
    const row = decisions.findByKey('TEST-ADR-1');
    expect(row).not.toBeNull();
    expect(row?.impacts).toEqual([]);
  });

  it('findByProject does not throw a JSON.parse SyntaxError', () => {
    expect(() => decisions.findByProject(projectId)).not.toThrow();
    const all = decisions.findByProject(projectId);
    expect(all).toHaveLength(1);
    expect(all[0]?.impacts).toEqual([]);
  });
});
