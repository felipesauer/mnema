import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

import type { AuditStateRepository } from '../sqlite/repositories/audit-state-repository.js';

/**
 * Append-only event written to the audit log.
 *
 * The shape mirrors the canonical structure documented in DESIGN.md
 * §10.5 and ARCHITECTURE.md §3.4. From schema `v: 2` every event also
 * carries `prev_hash` and `hash`, forming a per-file SHA-256 chain
 * that `mnema doctor` validates to detect tampering.
 */
export interface AuditEvent {
  /** Schema version for the event envelope. */
  readonly v: number;
  /** ISO8601 timestamp of when the event was emitted. */
  readonly at: string;
  /** Event kind, e.g. `"task_transitioned"`. */
  readonly kind: string;
  /** Handle of the human actor responsible. */
  readonly actor: string;
  /** Handle of the agent that performed the work, when applicable. */
  readonly via?: string;
  /** Identifier of the agent run, when applicable. */
  readonly run?: string;
  /** Event-specific payload. */
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * Hash of the previous line in the same file, or `null` for the
   * genesis line. Present on every event from schema `v: 2`.
   */
  readonly prev_hash?: string | null;
  /**
   * SHA-256 of this event with `hash` omitted, computed before the
   * line was appended. Present on every event from schema `v: 2`.
   */
  readonly hash?: string;
}

/**
 * Append-only writer for the audit log in JSONL format.
 *
 * Files are kept under {@link AuditWriter}'s `auditDir`:
 * - `current.jsonl` for the current month
 * - `YYYY-MM.jsonl` for archived months
 *
 * Rotation happens at write time: if the current file's mtime points to
 * a different month than `now()`, it is renamed to `YYYY-MM.jsonl` and
 * a fresh `current.jsonl` is started.
 *
 * When an {@link AuditStateRepository} is wired in, the writer also
 * (1) chains lines via `prev_hash`/`hash` and (2) mirrors event count,
 * last `at`, and chain-head hash into SQLite. With no repository
 * (legacy / standalone tests) the writer falls back to the unchained
 * v1 format so existing call sites still work.
 */
export class AuditWriter {
  private readonly currentFile: string;
  private readonly now: () => Date;

  /**
   * Initialises the writer. Creates the audit directory if needed and
   * triggers an immediate rotation check so the very first write lands
   * in the right month.
   *
   * @param auditDir - Absolute path to the audit directory
   * @param state - Optional SQLite mirror; enables hash chain + invariants
   * @param now - Optional clock; defaults to `() => new Date()`
   */
  constructor(
    private readonly auditDir: string,
    private readonly state: AuditStateRepository | null = null,
    now: () => Date = () => new Date(),
  ) {
    this.now = now;
    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }
    this.currentFile = path.join(auditDir, 'current.jsonl');
    this.checkRotation();
  }

  /**
   * Appends an event to `current.jsonl`, performing a rotation check first.
   *
   * When wired with an {@link AuditStateRepository}, fills in
   * `prev_hash` from the SQLite mirror, computes `hash`, writes the
   * line, and advances the mirror in a single sequence. The order
   * matters: the line on disk includes the hash that the mirror
   * records, so a subsequent doctor walk re-computes the same hash
   * and matches.
   *
   * @param event - Event to append (will be JSON-serialised on a single line)
   */
  write(event: AuditEvent): void {
    this.checkRotation();

    if (this.state === null) {
      // Legacy path: no chain, no mirror. Kept so tests that mount the
      // writer standalone keep working.
      const line = `${JSON.stringify(event)}\n`;
      appendFileSync(this.currentFile, line, { flag: 'a' });
      return;
    }

    // The append + mirror update must be serialised against concurrent
    // writers so the on-disk chain doesn't fork. `withChainAdvance`
    // wraps the trio in `BEGIN IMMEDIATE`: only one writer holds the
    // SQLite write lock at a time, so a second concurrent process is
    // queued and reads the new head when its turn comes up.
    this.state.withChainAdvance((currentHead) => {
      const chained: AuditEvent = {
        ...event,
        v: 2,
        prev_hash: currentHead,
      };
      const hash = hashEvent(chained);
      const sealed: AuditEvent = { ...chained, hash };
      const line = `${JSON.stringify(sealed)}\n`;
      appendFileSync(this.currentFile, line, { flag: 'a' });
      return { hash, at: sealed.at };
    });
  }

  /**
   * Returns the absolute path to the file currently receiving writes.
   *
   * @returns Path to `current.jsonl` inside the audit directory
   */
  getCurrentFile(): string {
    return this.currentFile;
  }

  /**
   * Checks whether the existing `current.jsonl` belongs to the current
   * month; rotates it to `YYYY-MM.jsonl` if not.
   */
  checkRotation(): void {
    if (!existsSync(this.currentFile)) return;

    const currentMonth = monthKey(this.now());
    const fileMonth = monthKey(statSync(this.currentFile).mtime);

    if (fileMonth !== currentMonth) {
      renameSync(this.currentFile, path.join(this.auditDir, `${fileMonth}.jsonl`));
    }
  }
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Computes the SHA-256 hash of an event with the `hash` field
 * omitted. The same canonicalisation is used by writer (to fill in
 * `hash`) and by doctor (to verify the chain), so any change here
 * must be applied in both spots.
 *
 * @param event - Event in its pre-sealed form (no `hash` field)
 * @returns Hex-encoded SHA-256 digest
 */
export function hashEvent(event: AuditEvent): string {
  const { hash: _omit, ...rest } = event;
  const payload = JSON.stringify(rest);
  return createHash('sha256').update(payload).digest('hex');
}
