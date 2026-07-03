import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import {
  AuditHeadSignatureRepository,
  type HeadSignature,
} from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/** True when a table of the given name exists in the schema. */
function tableExists(db: DatabaseType, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

describe('AuditHeadSignatureRepository (migration 022)', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let repo: AuditHeadSignatureRepository;

  const sample: HeadSignature = {
    coveredHeadHash: 'a'.repeat(64),
    eventCountAt: 42,
    signerActor: 'felipesauer',
    signerFingerprint: 'b'.repeat(64),
    signature: Buffer.from('a-signature').toString('base64'),
    signedAt: '2026-07-03T12:00:00.000Z',
  };

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-headsig-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    repo = new AuditHeadSignatureRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates the audit_head_signature table', () => {
    expect(tableExists(adapter.getDatabase(), 'audit_head_signature')).toBe(true);
  });

  it('reads null on a fresh project (no checkpoint signed yet)', () => {
    expect(repo.read()).toBeNull();
  });

  it('round-trips a signature: written then read is equal', () => {
    repo.upsert(sample);
    expect(repo.read()).toEqual(sample);
  });

  it('keeps only the latest signature (single row, overwrite on new checkpoint)', () => {
    repo.upsert(sample);
    const later: HeadSignature = {
      ...sample,
      coveredHeadHash: 'c'.repeat(64),
      eventCountAt: 99,
      signerActor: 'maria',
      signerFingerprint: 'd'.repeat(64),
      signedAt: '2026-07-03T13:00:00.000Z',
    };
    repo.upsert(later);
    expect(repo.read()).toEqual(later);
    // Exactly one row — the CHECK(id = 1) + upsert keep it single.
    const count = adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM audit_head_signature')
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('the single-row CHECK rejects a second id', () => {
    repo.upsert(sample);
    expect(() =>
      adapter
        .getDatabase()
        .prepare(
          `INSERT INTO audit_head_signature
             (id, covered_head_hash, event_count_at, signer_actor,
              signer_fingerprint, signature, signed_at)
           VALUES (2, ?, ?, ?, ?, ?, ?)`,
        )
        .run('x', 1, 'a', 'y', 'z', 'w'),
    ).toThrow();
  });
});
