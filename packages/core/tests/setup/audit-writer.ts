import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { auditTailDirs } from '@/storage/audit/audit-files.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import type { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

/**
 * Builds a real chained, HMAC-keyed {@link AuditWriter} for tests whose
 * subject is NOT the audit machinery itself but which need a working audit
 * sink (memory/skill/decision/task services, etc.). The writer refuses to
 * seal without a secret and requires an {@link AuditStateRepository}; this
 * wires both — an ephemeral per-test secret and the migrated adapter's state
 * row — so a plain `audit.write` produces a genuine sealed line.
 *
 * @param adapter - A migrated SQLite adapter (the test already owns one)
 * @param auditDir - Directory for the JSONL tail
 * @returns A writer that seals lines and mirrors into `audit_state`
 */
export function chainedAuditWriter(adapter: SqliteAdapter, auditDir: string): AuditWriter {
  const secret = randomBytes(32);
  return new AuditWriter(auditDir, new AuditStateRepository(adapter), () => secret);
}

/**
 * Resolves the single machine tail under a project audit dir and returns a
 * file inside it (defaulting to `current.jsonl`). Writes through the container
 * / CLI land in `audit/m-<id>/`, so a test that wrote via those paths and then
 * wants to read or tamper the on-disk line must go through the tail, not the
 * flat `audit/current.jsonl`. Asserts exactly one tail exists — the shape
 * every single-machine test produces.
 *
 * @param auditDir - The project audit dir (`.mnema/audit`)
 * @param name - File within the tail; defaults to `current.jsonl`
 * @returns Absolute path to that file inside the sole tail
 */
export function soleTailFile(auditDir: string, name = 'current.jsonl'): string {
  const tails = auditTailDirs(auditDir);
  if (tails.length !== 1) {
    throw new Error(`expected exactly one audit tail under ${auditDir}, found ${tails.length}`);
  }
  return path.join(tails[0] as string, name);
}
