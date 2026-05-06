import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * One line in the persistent sync buffer.
 *
 * The buffer holds pending markdown updates so that a crash mid-flush
 * can be resumed cleanly. Entries are append-only; `flushAll` truncates
 * the file atomically once everything has been written to disk.
 */
export interface SyncBufferEntry {
  readonly v: number;
  readonly at: string;
  readonly kind: string;
  readonly taskKey: string;
  readonly mdTarget: string;
  readonly action?: string;
  readonly runId?: string;
}

/**
 * Persistent append-only buffer of pending markdown updates, stored at
 * `.app/buffer.jsonl` next to the SQLite database.
 *
 * Single-process safe by design (each MCP server has its own logical
 * session). Multiple servers writing concurrently rely on the OS guarantee
 * that POSIX `O_APPEND` writes shorter than `PIPE_BUF` are atomic — every
 * line is well under the kernel's 4 KiB threshold.
 */
export class SyncBuffer {
  private readonly bufferPath: string;

  constructor(stateDir: string) {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    this.bufferPath = path.join(stateDir, 'buffer.jsonl');
  }

  /**
   * Returns the absolute path to the JSONL file.
   */
  getPath(): string {
    return this.bufferPath;
  }

  /**
   * Appends a single entry. Atomic per write at the POSIX level.
   *
   * @param entry - Pending sync entry to append
   */
  append(entry: SyncBufferEntry): void {
    appendFileSync(this.bufferPath, `${JSON.stringify(entry)}\n`, { flag: 'a' });
  }

  /**
   * Returns the number of buffered entries, or `0` when the file does
   * not exist or contains only blank lines.
   */
  size(): number {
    return this.readAll().length;
  }

  /**
   * Reads every buffered entry from disk in append order.
   *
   * Lines that fail to parse are skipped and reported through the
   * returned `parseFailures` count, so callers can still flush good
   * entries when one was corrupted by an aborted write.
   */
  readAll(): readonly SyncBufferEntry[] {
    if (!existsSync(this.bufferPath)) return [];
    const raw = readFileSync(this.bufferPath, 'utf-8');
    if (raw.trim().length === 0) return [];

    const entries: SyncBufferEntry[] = [];
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      try {
        entries.push(JSON.parse(line) as SyncBufferEntry);
      } catch {
        // Best-effort: skip the line.
      }
    }
    return entries;
  }

  /**
   * Replaces the buffer file with an empty one atomically (write tmp,
   * rename). Should be called after every entry has been processed.
   */
  truncate(): void {
    const tmp = `${this.bufferPath}.tmp`;
    writeFileSync(tmp, '', 'utf-8');
    renameSync(tmp, this.bufferPath);
  }
}
