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
  /** `event_count` at which this anchor was made — the by-events baseline. */
  readonly eventCountAt: number | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

interface AnchorRow {
  readonly head_hash: string;
  readonly provider: string;
  readonly status: AnchorRecordStatus;
  readonly receipt: string | null;
  readonly event_count_at: number | null;
  readonly created_at: string;
  readonly confirmed_at: string | null;
}

/** Fields an upsert supplies; timestamps are managed by the store. */
export interface AnchorUpsert {
  readonly headHash: string;
  readonly provider: string;
  readonly status: AnchorRecordStatus;
  readonly receipt: string | null;
  /** `event_count` at anchor time; omitted → NULL (time-only interval). */
  readonly eventCountAt?: number;
}

/**
 * Persistence for {@link AnchorRecord} rows. Multi-row: one
 * head may be anchored by several providers, and each anchor moves
 * `pending → anchored` over its life. Keyed by `(head_hash, provider)`, so
 * re-stamping the same head with the same provider upserts (e.g. a later
 * confirmation completing a pending proof) rather than duplicating.
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
        `INSERT INTO anchors (head_hash, provider, status, receipt, event_count_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ${confirmedAt})
         ON CONFLICT(head_hash, provider) DO UPDATE SET
            status = excluded.status,
            receipt = excluded.receipt,
            event_count_at = COALESCE(excluded.event_count_at, anchors.event_count_at),
            confirmed_at = ${confirmedAt}`,
      )
      .run(
        anchor.headHash,
        anchor.provider,
        anchor.status,
        anchor.receipt,
        anchor.eventCountAt ?? null,
      );
  }

  /** The most recent anchor for `provider` (by event_count then time), or null. */
  latestForProvider(provider: string): AnchorRecord | null {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT head_hash, provider, status, receipt, event_count_at, created_at, confirmed_at
           FROM anchors WHERE provider = ?
          ORDER BY COALESCE(event_count_at, 0) DESC, created_at DESC LIMIT 1`,
      )
      .get(provider) as AnchorRow | undefined;
    return row === undefined ? null : toRecord(row);
  }

  /** Reads the anchor for one `(headHash, provider)`, or `null`. */
  read(headHash: string, provider: string): AnchorRecord | null {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT head_hash, provider, status, receipt, event_count_at, created_at, confirmed_at
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
        `SELECT head_hash, provider, status, receipt, event_count_at, created_at, confirmed_at
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
        `SELECT head_hash, provider, status, receipt, event_count_at, created_at, confirmed_at
           FROM anchors ORDER BY created_at DESC`,
      )
      .all() as AnchorRow[];
    return rows.map(toRecord);
  }

  /**
   * Deletes every anchor whose `event_count_at` is at or below `cut` — the
   * anchors that stamped a head inside a pruned prefix (the prune lockstep). An
   * anchor at `event_count_at = N` covers the head at chained index `N - 1`, so
   * `event_count_at <= cut` means the anchored head was in `[0, cut)` and is now
   * deleted; leaving the row would keep a receipt over a removed tail.
   *
   * Anchors ABOVE the cut are untouched: an anchor is verified by its
   * `head_hash` (which survives intact on disk), not by `event_count_at` — that
   * field is only an ordering baseline, so a post-prune index shift does not
   * invalidate a surviving anchor. Rows with a NULL `event_count_at` (time-only
   * intervals) are never deleted — they name no event position to be below the
   * cut.
   *
   * @param cut - The chained-event index the prune drops below
   * @returns The number of anchor rows removed
   */
  deleteBelowEventCount(cut: number): number {
    const result = this.adapter
      .getDatabase()
      .prepare(`DELETE FROM anchors WHERE event_count_at IS NOT NULL AND event_count_at <= ?`)
      .run(cut);
    return result.changes;
  }
}

function toRecord(row: AnchorRow): AnchorRecord {
  return {
    headHash: row.head_hash,
    provider: row.provider,
    status: row.status,
    receipt: row.receipt,
    eventCountAt: row.event_count_at,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}
