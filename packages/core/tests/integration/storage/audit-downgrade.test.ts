import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { hashEvent, hmacEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * The naive per-line dispatch (v2→SHA-256, v3→HMAC) admits a DOWNGRADE:
 * a local editor with no secret rewrites v3 lines as v2 (keyless SHA-256
 * they can recompute), cascades prev_hash, and rewrites the SQLite head —
 * doctor then reads "verified" over a forged log, defeating layer 2. Two
 * rules close it: version monotonicity (never regress v3→v2) and
 * fingerprint-implies-v3 (an all-v2 chain in a fingerprinted project is a
 * wholesale downgrade). Legitimate v2→v3 migration is unaffected.
 */
describe('audit chain downgrade defense', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  const secret = Buffer.from(`ab`.repeat(32), 'hex');

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-downgrade-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const currentFile = (): string => path.join(auditDir, 'current.jsonl');
  const chainCheck = (secretArg: Buffer | null, hasFingerprint: boolean) =>
    inspectAuditIntegrity(adapter, auditDir, secretArg, hasFingerprint).find(
      (c) => c.name === 'audit hash chain',
    );
  const anchorCheck = (secretArg: Buffer | null, hasFingerprint: boolean) =>
    inspectAuditIntegrity(adapter, auditDir, secretArg, hasFingerprint).find(
      (c) => c.name === 'audit downgrade anchor',
    );

  /**
   * Hand-builds a chain of the given per-line versions, sets the SQLite
   * head to the last hash. v3 lines are HMAC-keyed with `secret`. This is
   * what an attacker (for a downgraded chain) or a legit migration produces.
   */
  function buildChain(versions: number[]): void {
    let prev: string | null = null;
    const lines: string[] = [];
    versions.forEach((v, i) => {
      const ev: AuditEvent = {
        v,
        at: `2026-07-03T00:00:0${i}.000Z`,
        kind: 'task_created',
        actor: 'x',
        data: { key: `T-${i}` },
        prev_hash: prev,
      };
      const hash = v >= 3 ? hmacEvent(ev, secret) : hashEvent(ev);
      prev = hash;
      lines.push(JSON.stringify({ ...ev, hash }));
    });
    writeFileSync(currentFile(), `${lines.join('\n')}\n`, 'utf-8');
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET chain_head_hash = ?, event_count = ? WHERE id = 1')
      .run(prev, versions.length);
  }

  it('catches the full downgrade attack: a real v3 chain rewritten to keyless v2 + SQLite head', () => {
    // Write a genuine v3 chain through the secret-wired writer.
    const audit = new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, () => secret),
    );
    audit.write({ kind: 'task_created', actor: 'alice', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'bob', data: { key: 'T-2' } });
    // Sanity: it verifies before the attack.
    expect(chainCheck(secret, true)?.ok).toBe(true);

    // ATTACK: rewrite every line as v2 keyless (forge actor), cascade
    // prev_hash, and rewrite the local SQLite head to the new v2 tail.
    const attacked = readFileSync(currentFile(), 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    let prev: string | null = null;
    for (const line of attacked) {
      line.actor = 'mallory';
      line.v = 2;
      line.prev_hash = prev;
      delete line.hash;
      const hash = hashEvent(line as unknown as AuditEvent);
      line.hash = hash;
      prev = hash;
    }
    writeFileSync(currentFile(), `${attacked.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf-8');
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET chain_head_hash = ? WHERE id = 1')
      .run(prev);

    // The committed fingerprint means the project adopted v3, so an
    // all-v2 chain is a wholesale downgrade — caught even though the head
    // and every per-line SHA-256 is internally consistent.
    const chain = chainCheck(secret, true);
    expect(chain?.ok).toBe(false);
    expect(chain?.detail).toMatch(/wholesale v3→v2 downgrade|entirely v2/i);
  });

  it('catches a partial downgrade: a v2 line after a v3 line (version monotonicity)', () => {
    buildChain([3, 2]);
    const chain = chainCheck(secret, true);
    expect(chain?.ok).toBe(false);
    expect(chain?.detail).toMatch(/downgrade to v2|cannot regress/i);
  });

  it('allows a legitimate v2→v3 migration (version never decreases)', () => {
    buildChain([2, 2, 3]);
    // With the fingerprint present and at least one v3 line, and versions
    // only increasing, the chain verifies.
    expect(chainCheck(secret, true)?.ok).toBe(true);
  });

  it('a v2-only project with NO fingerprint (pre-adoption) still verifies', () => {
    buildChain([2, 2]);
    // No fingerprint ⇒ the project never adopted v3, so an all-v2 chain is
    // legitimate history, not a downgrade.
    expect(chainCheck(null, false)?.ok).toBe(true);
  });

  it('the fingerprint rule still applies without the secret (clone detects a wholesale downgrade)', () => {
    // A clone has the committed fingerprint but not the secret. An all-v2
    // chain there is still a downgrade — the fingerprint rule does not need
    // the secret. (A genuine v3 chain here would instead be 'unverifiable'.)
    buildChain([2, 2]);
    const chain = chainCheck(null, true);
    expect(chain?.ok).toBe(false);
    expect(chain?.detail).toMatch(/entirely v2|downgrade/i);
  });

  it('warns when a v3 chain has NO committed fingerprint (downgrade anchor disarmed)', () => {
    // A v3 chain but the fingerprint is absent — the anchor that guards the
    // wholesale downgrade is missing (never committed, or deleted to disarm
    // the defense). Must warn, not pass silently.
    buildChain([3, 3]);
    const anchor = anchorCheck(secret, false);
    expect(anchor?.ok).toBe(false);
    expect(anchor?.severity).toBe('warning');
    expect(anchor?.detail).toMatch(/no committed fingerprint|disarmed/i);
  });

  it('does not warn when the v3 chain has its committed fingerprint (anchor armed)', () => {
    buildChain([3, 3]);
    expect(anchorCheck(secret, true)).toBeUndefined();
  });
});
