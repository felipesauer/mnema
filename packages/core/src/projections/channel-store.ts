/**
 * Persisting and querying the channel switch projection in SQLite.
 *
 * The pure fold produces where each switch stands; this module writes those rows into
 * `channel_switches` and reads them back. Like every projection store it is a CACHE of
 * the chain — dropped and replayed on a rebuild, never authored directly.
 *
 * THE READ IS A KEYED LOOKUP AND THAT IS DELIBERATE. The one consumer that matters asks
 * about a named channel on the hot path a host runs before every file is written, so the
 * question is "is THIS channel off" and the answer is one row by primary key. The listing
 * exists for the verb that shows a person where every switch stands, which runs once when
 * somebody types it.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { ChannelSwitchProjection } from './channel.js';

/**
 * The `channel_switches` row shape as stored.
 *
 * `switched_on` is an INTEGER because STRICT tables have no boolean type — the same
 * spelling `runs.open` already uses for the same reason.
 */
interface ChannelSwitchRow {
  readonly channel: string;
  readonly switched_on: number;
  readonly who: string;
  readonly which: string | null;
  readonly switched_at: string;
  readonly reason: string | null;
}

/**
 * Inserts the given switch projections. Called during a rebuild after the table has
 * been recreated empty, so every switch is a fresh insert. The caller owns the
 * surrounding transaction.
 */
export function materializeChannelSwitches(
  db: SqliteDatabase,
  switches: Iterable<ChannelSwitchProjection>,
): void {
  const insert = db.prepare(
    `INSERT INTO channel_switches (channel, switched_on, who, which, switched_at, reason)
     VALUES (@channel, @switchedOn, @who, @which, @switchedAt, @reason)`,
  );
  for (const state of switches) {
    insert.run({
      channel: state.channel,
      switchedOn: state.on ? 1 : 0,
      who: state.who,
      which: state.which ?? null,
      switchedAt: state.switchedAt,
      reason: state.reason ?? null,
    });
  }
}

/**
 * Reads where one channel's switch stands, or null when nothing ever switched it.
 *
 * `null` is the ordinary answer and it means the channel is ON — see
 * {@link ChannelSwitchProjection}. It is returned rather than defaulted here because a
 * store answers about rows, and inventing a row for a channel the record never mentions
 * would put this module's opinion of the default into every reader that asks.
 */
export function getChannelSwitch(
  db: SqliteDatabase,
  channel: string,
): ChannelSwitchProjection | null {
  const row = db.prepare('SELECT * FROM channel_switches WHERE channel = ?').get(channel) as
    | ChannelSwitchRow
    | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists every switch the record moved, ordered by channel for a stable result. */
export function listChannelSwitches(db: SqliteDatabase): ChannelSwitchProjection[] {
  const rows = db
    .prepare('SELECT * FROM channel_switches ORDER BY channel')
    .all() as ChannelSwitchRow[];
  return rows.map(toProjection);
}

function toProjection(row: ChannelSwitchRow): ChannelSwitchProjection {
  return {
    channel: row.channel,
    on: row.switched_on !== 0,
    who: row.who,
    ...(row.which !== null ? { which: row.which } : {}),
    switchedAt: row.switched_at,
    ...(row.reason !== null ? { reason: row.reason } : {}),
  };
}
