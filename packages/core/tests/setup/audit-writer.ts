import { randomBytes } from 'node:crypto';
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
