import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Append-only event written to the audit log.
 *
 * The shape mirrors the canonical structure documented in DESIGN.md
 * §10.5 and ARCHITECTURE.md §3.4.
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
   * @param now - Optional clock; defaults to `() => new Date()`
   */
  constructor(
    private readonly auditDir: string,
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
   * @param event - Event to append (will be JSON-serialised on a single line)
   */
  write(event: AuditEvent): void {
    this.checkRotation();
    const line = `${JSON.stringify(event)}\n`;
    appendFileSync(this.currentFile, line, { flag: 'a' });
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
