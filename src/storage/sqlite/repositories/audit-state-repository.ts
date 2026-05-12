import type { SqliteAdapter } from '../sqlite-adapter.js';

/**
 * Snapshot of the audit-log invariants mirrored into SQLite.
 *
 * The audit log itself lives outside the database as JSONL files.
 * This row is updated atomically with every `AuditWriter.write()` so
 * `mnema doctor` can compare its values against what is actually on
 * disk and detect tampering (truncation, deletion, edits that break
 * the hash chain).
 */
export interface AuditState {
  /** Total events written through the writer since project creation. */
  readonly eventCount: number;
  /** `at` timestamp of the most recent event, or `null` if none yet. */
  readonly lastEventAt: string | null;
  /** SHA-256 of the most recent line (pre-append), or `null` if none yet. */
  readonly chainHeadHash: string | null;
  /** Wall-clock of the last update — diagnostic only. */
  readonly updatedAt: string;
}

interface AuditStateRow {
  readonly event_count: number;
  readonly last_event_at: string | null;
  readonly chain_head_hash: string | null;
  readonly updated_at: string;
}

/**
 * Persistence for the single-row {@link AuditState} mirror. Reads are
 * cheap and frequent (every `AuditWriter.write()` reads + bumps the
 * counter), so the SELECT + UPDATE pair is intentionally not wrapped
 * in a transaction — the audit dir is single-writer in practice.
 */
export class AuditStateRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Reads the current state. Migration 011 seeded `id = 1`, so this
   * always returns a row on a migrated project.
   *
   * @returns The audit-state row
   */
  read(): AuditState {
    const row = this.adapter
      .getDatabase()
      .prepare(
        'SELECT event_count, last_event_at, chain_head_hash, updated_at FROM audit_state WHERE id = 1',
      )
      .get() as AuditStateRow | undefined;
    if (row === undefined) {
      throw new Error('audit_state row is missing — migration 011 may not have been applied');
    }
    return {
      eventCount: row.event_count,
      lastEventAt: row.last_event_at,
      chainHeadHash: row.chain_head_hash,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Atomically advances the mirror after a single event has been
   * appended to the JSONL log.
   *
   * @param eventAt - `at` ISO timestamp of the event that was written
   * @param chainHeadHash - SHA-256 of the line as written to disk
   */
  recordEvent(eventAt: string, chainHeadHash: string): void {
    this.adapter
      .getDatabase()
      .prepare(
        `UPDATE audit_state
            SET event_count = event_count + 1,
                last_event_at = ?,
                chain_head_hash = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = 1`,
      )
      .run(eventAt, chainHeadHash);
  }
}
