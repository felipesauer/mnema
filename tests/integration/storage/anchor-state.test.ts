import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AnchorRepository } from '@/storage/sqlite/repositories/anchor-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

function tableExists(db: DatabaseType, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

describe('AnchorRepository (migration 023)', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let repo: AnchorRepository;
  const head = 'a'.repeat(64);

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-anchors-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    repo = new AnchorRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates the anchors table', () => {
    expect(tableExists(adapter.getDatabase(), 'anchors')).toBe(true);
  });

  it('round-trips a pending anchor (NULL receipt allowed)', () => {
    repo.upsert({ headHash: head, provider: 'opentimestamps', status: 'pending', receipt: null });
    const rec = repo.read(head, 'opentimestamps');
    expect(rec?.status).toBe('pending');
    expect(rec?.receipt).toBeNull();
    expect(rec?.confirmedAt).toBeNull();
    expect(rec?.createdAt).toBeTruthy();
  });

  it('persists a pending → anchored transition and stamps confirmed_at', () => {
    repo.upsert({ headHash: head, provider: 'opentimestamps', status: 'pending', receipt: null });
    // A large receipt blob (OTS proofs can be sizable) round-trips.
    const proof = 'x'.repeat(4096);
    repo.upsert({
      headHash: head,
      provider: 'opentimestamps',
      status: 'anchored',
      receipt: proof,
    });
    const rec = repo.read(head, 'opentimestamps');
    expect(rec?.status).toBe('anchored');
    expect(rec?.receipt).toBe(proof);
    expect(rec?.confirmedAt).toBeTruthy();
    // Still a single row for this (head, provider).
    expect(repo.listAll()).toHaveLength(1);
  });

  it('holds multiple anchors for one head across providers', () => {
    repo.upsert({ headHash: head, provider: 'opentimestamps', status: 'pending', receipt: null });
    repo.upsert({ headHash: head, provider: 'rfc3161', status: 'anchored', receipt: 'token' });
    expect(repo.read(head, 'opentimestamps')?.status).toBe('pending');
    expect(repo.read(head, 'rfc3161')?.status).toBe('anchored');
    expect(repo.listAll()).toHaveLength(2);
  });

  it('lists only pending anchors for the scheduler', () => {
    repo.upsert({ headHash: head, provider: 'opentimestamps', status: 'pending', receipt: null });
    repo.upsert({
      headHash: 'b'.repeat(64),
      provider: 'rfc3161',
      status: 'anchored',
      receipt: 't',
    });
    const pending = repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.provider).toBe('opentimestamps');
  });

  it('rejects an invalid status via the CHECK constraint', () => {
    expect(() =>
      adapter
        .getDatabase()
        .prepare('INSERT INTO anchors (head_hash, provider, status) VALUES (?, ?, ?)')
        .run(head, 'x', 'bogus'),
    ).toThrow();
  });

  it('reads null for an unknown (head, provider)', () => {
    expect(repo.read(head, 'rfc3161')).toBeNull();
  });
});
