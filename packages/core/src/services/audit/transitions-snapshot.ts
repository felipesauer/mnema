import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AuditEvent } from '../../storage/audit/audit-writer.js';

/**
 * One transition projected from the audit chain, in the human-facing shape the
 * snapshot persists. Unlike the `transitions` table row, actor/via are kept as
 * HANDLES (verbatim from the event envelope): the snapshot is a committed,
 * readable archive of the pruned history, not a cache to resolve against ids.
 */
export interface ProjectedTransition {
  readonly taskId: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly actor: string;
  readonly via: string | null;
  readonly run: string | null;
  readonly at: string;
}

/**
 * Projects the transition-bearing events of a chain segment into transition
 * rows. A `task_created` event becomes the initial `create` row (synthesised —
 * it carries only id/title/state); a `task_transitioned` event maps directly,
 * defaulting an omitted (empty) payload to `{}`. Every other kind is ignored.
 * The output is chain-ordered by `at` so a reader sees the true sequence.
 *
 * Shared by the prune-time snapshot (archiving events about to be deleted) and
 * mirrored by the live-table rebuild in sync-rebuild — the same event to row
 * synthesis, so the two never diverge.
 *
 * @param events - Audit events (any kinds; non-transition ones are skipped)
 * @returns The projected transitions, oldest first
 */
export function projectTransitions(events: readonly AuditEvent[]): ProjectedTransition[] {
  const rows: ProjectedTransition[] = [];
  for (const event of events) {
    if (event.kind !== 'task_created' && event.kind !== 'task_transitioned') continue;
    const data = event.data as Record<string, unknown>;
    const taskId = typeof data.id === 'string' ? data.id : null;
    if (taskId === null) continue;

    const isCreate = event.kind === 'task_created';
    const str = (key: string): string | null =>
      typeof data[key] === 'string' ? (data[key] as string) : null;
    const payload =
      typeof data.payload === 'object' && data.payload !== null && !Array.isArray(data.payload)
        ? (data.payload as Record<string, unknown>)
        : {};

    rows.push({
      taskId,
      fromState: isCreate ? null : str('from'),
      toState: isCreate ? (str('state') ?? '') : (str('to') ?? ''),
      action: isCreate ? 'create' : (str('action') ?? ''),
      payload: isCreate ? { title: str('title') ?? '' } : payload,
      actor: event.actor,
      via: event.via ?? null,
      run: event.run ?? null,
      at: event.at,
    });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * File (relative to a machine tail dir) holding the committed snapshot of the
 * transition history that a prune removed from the chain. Committed alongside
 * `rebaseline.json` so the "why" of a pruned transition (its gate payload) is
 * never lost to disk pruning — the projection can no longer recover it from the
 * chain once the events are gone.
 */
const TRANSITIONS_SNAPSHOT_FILE = 'transitions-snapshot.json';

/** Absolute path to the committed transitions snapshot for a tail dir. */
export function transitionsSnapshotPath(tailDir: string): string {
  return path.join(tailDir, TRANSITIONS_SNAPSHOT_FILE);
}

/**
 * Appends projected transitions to a tail's committed snapshot, preserving any
 * already archived by an earlier prune. A prune only ever removes an older
 * prefix of the chain, so successive snapshots accrete oldest-first history;
 * merging keeps the whole record rather than letting a later prune clobber an
 * earlier archive. Deduplicates on (taskId, at, action, fromState, toState) so
 * re-running a prune that overlaps a prior cut cannot double-record a row,
 * while two genuinely distinct same-millisecond transitions (different states)
 * both survive.
 *
 * A malformed existing file is a HARD ERROR, not an empty start: this function
 * overwrites the file, and treating a corrupt archive as empty would silently
 * destroy an earlier prune's records (unrecoverable — the chain segments are
 * already gone). It runs before the prune deletes anything, so throwing aborts
 * the prune with nothing lost. (The read-only {@link readTransitionsSnapshot}
 * stays lenient — a reader tolerating a corrupt file is safe; a writer is not.)
 *
 * @param tailDir - Absolute path to a machine tail (`audit/m-<id>/`)
 * @param rows - The newly projected transitions to archive
 */
export function appendTransitionsSnapshot(
  tailDir: string,
  rows: readonly ProjectedTransition[],
): void {
  const file = transitionsSnapshotPath(tailDir);
  const existing: ProjectedTransition[] = [];
  if (existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (error) {
      throw new Error(
        `transitions snapshot at ${file} is malformed JSON; refusing to overwrite it and lose the archived history it holds. Repair or remove it first. (${String(error)})`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        `transitions snapshot at ${file} is not an array; refusing to overwrite a possibly real archive. Repair or remove it first.`,
      );
    }
    existing.push(...(parsed as ProjectedTransition[]));
  }

  const merged = [...existing];
  const seen = new Set(
    existing.map((r) => `${r.taskId} ${r.at} ${r.action} ${r.fromState ?? ''} ${r.toState}`),
  );
  for (const row of rows) {
    const key = `${row.taskId} ${row.at} ${row.action} ${row.fromState ?? ''} ${row.toState}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  merged.sort((a, b) => a.at.localeCompare(b.at));
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
}

/**
 * Reads a tail's committed transitions snapshot, or `[]` when absent or
 * malformed (a malformed file is treated as no snapshot — never a crash). This
 * is the READ path; the append path {@link appendTransitionsSnapshot} instead
 * refuses on a malformed file, since it would overwrite it.
 *
 * @param tailDir - Absolute path to a machine tail (`audit/m-<id>/`)
 * @returns The archived transitions, or an empty array
 */
export function readTransitionsSnapshot(tailDir: string): ProjectedTransition[] {
  const file = transitionsSnapshotPath(tailDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as ProjectedTransition[]) : [];
  } catch {
    return [];
  }
}
