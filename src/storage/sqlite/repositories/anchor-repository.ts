import type { SqliteAdapter } from '../sqlite-adapter.js';

/** The lifecycle status of a persisted anchor. */
export type AnchorRecordStatus = 'pending' | 'anchored' | 'failed';

/** A persisted anchor: one head, one provider, its proof and lifecycle. */
export interface AnchorRecord {
  readonly headHash: string;
  readonly provider: string;
  readonly status: AnchorRecordStatus;
  /** Serialized provider-specific proof, or `null` while pending. */
  readonly receipt: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

interface AnchorRow {
  readonly head_hash: string;
  readonly provider: string;
  readonly status: AnchorRecordStatus;
  readonly receipt: string | null;
  readonly created_at: string;
  readonly confirmed_at: string | null;
}

/** Fields an upsert supplies; timestamps are managed by the store. */
export interface AnchorUpsert {
  readonly headHash: string;
  readonly provider: string;
  readonly status: AnchorRecordStatus;
  readonly receipt: string | null;
}

/**
 * Persistence for {@link AnchorRecord} rows (ADR-37 layer 3). Multi-row: one
 * head may be anchored by several providers, and each anchor moves
 * `pending → anchored` over its life. Keyed by `(head_hash, provider)`, so
 * re-stamping the same head with the same provider upserts (e.g. an
 * OpenTimestamps upgrade completing the proof) rather than duplicating.
 */
export class AnchorRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Inserts or updates the anchor for `(headHash, provider)`. On conflict
   * the status, receipt and `confirmed_at` are updated; `confirmed_at` is
   * stamped when the status becomes `anchored` and cleared otherwise.
   *
   * @param anchor - The anchor fields to persist
   */
  upsert(anchor: AnchorUpsert): void {
    const confirmedAt =
      anchor.status === 'anchored' ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : 'NULL';
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO anchors (head_hash, provider, status, receipt, confirmed_at)
         VALUES (?, ?, ?, ?, ${confirmedAt})
         ON CONFLICT(head_hash, provider) DO UPDATE SET
            status = excluded.status,
            receipt = excluded.receipt,
            confirmed_at = ${confirmedAt}`,
      )
      .run(anchor.headHash, anchor.provider, anchor.status, anchor.receipt);
  }

  /** Reads the anchor for one `(headHash, provider)`, or `null`. */
  read(headHash: string, provider: string): AnchorRecord | null {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT head_hash, provider, status, receipt, created_at, confirmed_at
           FROM anchors WHERE head_hash = ? AND provider = ?`,
      )
      .get(headHash, provider) as AnchorRow | undefined;
    return row === undefined ? null : toRecord(row);
  }

  /** All anchors still `pending` — what the scheduler retries/upgrades. */
  listPending(): AnchorRecord[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT head_hash, provider, status, receipt, created_at, confirmed_at
           FROM anchors WHERE status = 'pending' ORDER BY created_at`,
      )
      .all() as AnchorRow[];
    return rows.map(toRecord);
  }

  /** Every anchor, newest first — used by doctor / verification reporting. */
  listAll(): AnchorRecord[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT head_hash, provider, status, receipt, created_at, confirmed_at
           FROM anchors ORDER BY created_at DESC`,
      )
      .all() as AnchorRow[];
    return rows.map(toRecord);
  }
}

function toRecord(row: AnchorRow): AnchorRecord {
  return {
    headHash: row.head_hash,
    provider: row.provider,
    status: row.status,
    receipt: row.receipt,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}
