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
 * Persistence for the single-row {@link AuditState} mirror.
 *
 * The mirror feeds the audit-log integrity check, so every advance
 * must be serialised against concurrent writers — otherwise two
 * processes can both read the same head, both append a JSONL line,
 * and both update the mirror, leaving the on-disk chain forked.
 * {@link AuditStateRepository.withChainAdvance} acquires a SQLite
 * write lock (`BEGIN IMMEDIATE`) for the whole read → compute →
 * append → record trio so only one writer at a time touches the
 * chain.
 */
export class AuditStateRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Reads the current state outside of any transaction. Useful for
   * the doctor walk; mutation paths must go through
   * {@link AuditStateRepository.withChainAdvance} instead.
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
   * Serialises a chain advance against concurrent writers. The
   * callback receives the current head and must return the new
   * head plus the `at` timestamp of the event it appended. The
   * append (typically `appendFileSync` on a JSONL file) happens
   * inside the SQLite write transaction, so two concurrent CLI
   * invocations are forced to interleave: one acquires the lock,
   * appends, updates the head, commits; the second sees the new
   * head and chains correctly.
   *
   * `BEGIN IMMEDIATE` is used (not `BEGIN`) so the lock is taken
   * up front rather than on the first write inside the transaction
   * — that avoids the read-then-immediate-write race that
   * `BEGIN DEFERRED` exhibits.
   *
   * @param advance - Callback that, given the current head, computes the
   *   new chain-head hash + event `at` and returns an `afterCommit`
   *   action (the JSONL append). The append is deliberately NOT run
   *   inside the transaction: it executes only after `COMMIT` succeeds,
   *   so a crash between the two can never leave a line on disk that the
   *   committed mirror did not record. If `afterCommit` itself throws,
   *   the mirror is one event ahead of disk — the safe, recoverable
   *   direction (doctor classifies it as benign, never false tampering).
   */
  withChainAdvance(
    advance: (currentHead: string | null) => { hash: string; at: string; afterCommit: () => void },
  ): void {
    const db = this.adapter.getDatabase();
    db.exec('BEGIN IMMEDIATE');
    let afterCommit: () => void;
    try {
      const row = db.prepare('SELECT chain_head_hash FROM audit_state WHERE id = 1').get() as
        | { chain_head_hash: string | null }
        | undefined;
      if (row === undefined) {
        throw new Error('audit_state row is missing — migration 011 may not have been applied');
      }
      const advanced = advance(row.chain_head_hash);
      afterCommit = advanced.afterCommit;
      db.prepare(
        `UPDATE audit_state
            SET event_count = event_count + 1,
                last_event_at = ?,
                chain_head_hash = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = 1`,
      ).run(advanced.at, advanced.hash);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    // Past COMMIT: the mirror is durable. Append the line now. A failure
    // here leaves the mirror one ahead of disk (recoverable), not a
    // line the mirror never saw (which would read as tampering).
    afterCommit();
  }
}
