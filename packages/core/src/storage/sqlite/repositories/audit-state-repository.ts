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
   * Serialises a chain advance against concurrent writers within one
   * process. The callback receives the current head and returns the new
   * head, the event `at`, and an `afterCommit` action (the JSONL append).
   * This method orders only the SQLite mirror update via `BEGIN
   * IMMEDIATE`; the append runs after COMMIT (see below) and is therefore
   * NOT ordered across processes by this transaction alone. The caller
   * (`AuditWriter`) wraps the whole call in a cross-process file lock so
   * two processes cannot interleave commit-order and append-order.
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

  /**
   * Reconciles the mirror to the actual on-disk chain tail after a crash in
   * the commit→append window. If the mirror is EXACTLY one event ahead of
   * disk (the committed count/head reference a line the append never wrote),
   * rewind the mirror to the real disk tail: that phantom line never existed
   * on disk, so the next write must chain from the real tail, not the
   * phantom head — otherwise it forks the chain permanently.
   *
   * Only the exact one-ahead shape is reconciled. Any other divergence
   * (mirror behind disk, ahead by more than one) is left untouched for the
   * verifier to report as tampering — this method never masks those.
   *
   * SECURITY NOTE — the one-ahead shape is byte-for-byte indistinguishable
   * from a truncation of the last line: both leave the mirror one ahead with
   * a self-consistent disk tail. Rewinding is therefore correct for a crash
   * but, on its own, would silently accept a truncation of the most recent
   * (as-yet-unsigned) event. This is bounded, not unbounded:
   *   - A truncation that removes any event AT OR BELOW the last signed
   *     checkpoint is caught by the attestation layer (a durable signature
   *     covers a higher event_count than the chain now holds → hard error;
   *     see `attestationCheck`). The attacker cannot lower that signature
   *     without the machine key.
   *   - Only events written AFTER the last checkpoint (not yet signed) can be
   *     truncated undetectably, and closing THAT would require signing every
   *     event — which ADR-37 rejects to keep the write hot path cheap. The
   *     checkpoint interval is the knob that bounds this window.
   *
   * @param diskCount - Chained (keyed) lines actually present on disk
   * @param diskTailHash - `hash` of the last chained line on disk, or `null`
   *   when the disk chain is empty
   * @param lastAt - `at` of the last chained line on disk, or `null`
   * @returns True when a rewind was applied
   */
  reconcileToDisk(diskCount: number, diskTailHash: string | null, lastAt: string | null): boolean {
    const db = this.adapter.getDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db
        .prepare('SELECT event_count, chain_head_hash FROM audit_state WHERE id = 1')
        .get() as { event_count: number; chain_head_hash: string | null } | undefined;
      if (row === undefined) {
        db.exec('ROLLBACK');
        return false;
      }
      // Reconcile only the exact crash-window shape: mirror one ahead AND its
      // head does not match the disk tail (the phantom line's head).
      const oneAhead = row.event_count === diskCount + 1;
      const headDiverges = row.chain_head_hash !== diskTailHash;
      if (!oneAhead || !headDiverges) {
        db.exec('ROLLBACK');
        return false;
      }
      db.prepare(
        `UPDATE audit_state
            SET event_count = ?,
                last_event_at = ?,
                chain_head_hash = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = 1`,
      ).run(diskCount, lastAt, diskTailHash);
      db.exec('COMMIT');
      return true;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Unconditionally overwrites the mirror with the given disk-derived
   * values, regardless of how far it has diverged. Unlike
   * {@link AuditStateRepository.reconcileToDisk} (which only ever rewinds
   * the narrow, provably-safe one-ahead crash shape), this accepts any
   * divergence — including the multi-event drift a pre-`43e7113` mnema
   * (no cross-process write lock) could leave behind from two processes
   * committing the mirror in one order but appending to disk in another.
   *
   * This is a blunt recovery tool, not a per-write invariant: callers (the
   * `mnema audit reconcile` CLI command) are responsible for first proving
   * the on-disk chain is itself internally consistent — no broken
   * `prev_hash` links, no version downgrade, no malformed lines — so this
   * only ever re-points the mirror at a disk state already known to be
   * untampered. It must never be reached for a genuinely broken chain.
   *
   * @param eventCount - Chained (keyed) line count actually on disk
   * @param chainHeadHash - `hash` of the last chained line, or `null` if empty
   * @param lastEventAt - `at` of the last chained line, or `null` if empty
   */
  forceReconcile(
    eventCount: number,
    chainHeadHash: string | null,
    lastEventAt: string | null,
  ): void {
    const db = this.adapter.getDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE audit_state
            SET event_count = ?,
                last_event_at = ?,
                chain_head_hash = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = 1`,
      ).run(eventCount, lastEventAt, chainHeadHash);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
