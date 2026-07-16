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

  describe('deleteBelowEventCount (prune lockstep, ADR-68)', () => {
    const h = (n: number) => String(n).padStart(64, '0');

    it('removes anchors whose event_count_at is at or below the cut, keeps the rest', () => {
      repo.upsert({
        headHash: h(1),
        provider: 'git-signed',
        status: 'anchored',
        receipt: 'r',
        eventCountAt: 3,
      });
      repo.upsert({
        headHash: h(2),
        provider: 'git-signed',
        status: 'anchored',
        receipt: 'r',
        eventCountAt: 5,
      });
      repo.upsert({
        headHash: h(3),
        provider: 'git-signed',
        status: 'anchored',
        receipt: 'r',
        eventCountAt: 8,
      });
      // cut = 5: anchors at event_count_at 3 and 5 stamped heads inside [0, 5) → removed.
      const removed = repo.deleteBelowEventCount(5);
      expect(removed).toBe(2);
      const survivors = repo.listAll().map((a) => a.eventCountAt);
      expect(survivors).toEqual([8]);
    });

    it('never deletes a NULL event_count_at anchor (time-only interval)', () => {
      repo.upsert({ headHash: h(1), provider: 'rfc3161', status: 'anchored', receipt: 'r' }); // no eventCountAt → NULL
      repo.upsert({
        headHash: h(2),
        provider: 'rfc3161',
        status: 'anchored',
        receipt: 'r',
        eventCountAt: 2,
      });
      const removed = repo.deleteBelowEventCount(10);
      expect(removed).toBe(1); // only the eventCountAt=2 row
      expect(repo.listAll()).toHaveLength(1);
      expect(repo.listAll()[0]?.eventCountAt).toBeNull();
    });

    it('removes nothing when every anchor is above the cut', () => {
      repo.upsert({
        headHash: h(1),
        provider: 'git-signed',
        status: 'anchored',
        receipt: 'r',
        eventCountAt: 20,
      });
      expect(repo.deleteBelowEventCount(5)).toBe(0);
      expect(repo.listAll()).toHaveLength(1);
    });
  });
});
