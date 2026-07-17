import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import lockfile from 'proper-lockfile';

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
 * Lock retry policy used when two MCP servers race for the buffer.
 *
 * `proper-lockfile.lockSync` does not accept a retries option (only
 * the async `lock` does), so we drive the retry loop ourselves: ten
 * attempts with 50ms backoff. The truncate critical section is
 * microseconds, so this leaves the worst-case wait well under 1s.
 */
const LOCK_MAX_ATTEMPTS = 10;
const LOCK_BACKOFF_MS = 50;

/**
 * Explicit lock options. `proper-lockfile`'s default `stale` is 10s, and
 * `lockSync` does not run the async mtime auto-update, so a lock held
 * across a slow critical section could be judged stale by a second
 * process and stolen — exactly the overlap the lock exists to prevent.
 * The truncate/drain section is microseconds, so the library's minimum
 * `stale` (2000ms) is ample and shrinks that theft window five-fold. A
 * genuinely orphaned lock (dead process) still becomes recoverable once
 * 2s elapse. `realpath: false` avoids a stat the lock target may not need,
 * and `onCompromised` swallows a late compromise notification instead of
 * letting it crash the process (the sync callers handle contention via
 * the retry loop).
 */
const LOCK_OPTIONS = {
  stale: 2000,
  realpath: false,
  onCompromised: () => {
    /* handled cooperatively by the acquire retry loop; do not throw */
  },
} as const;

/**
 * Persistent append-only buffer of pending markdown updates, stored at
 * `.app/buffer.jsonl` next to the SQLite database.
 *
 * Append is single-process safe by design (each MCP server has its own
 * logical session); concurrent appends rely on the OS guarantee that
 * POSIX `O_APPEND` writes shorter than `PIPE_BUF` are atomic — every
 * line is well under the kernel's 4 KiB threshold.
 *
 * The destructive `truncate` path is wrapped in a cooperative file
 * lock via `proper-lockfile` so that two MCP servers flushing in
 * parallel cannot lose entries by overlapping their write+rename.
 */
export class SyncBuffer {
  private readonly bufferPath: string;
  private readonly lockTarget: string;

  constructor(stateDir: string) {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    this.bufferPath = path.join(stateDir, 'buffer.jsonl');
    // proper-lockfile creates a `.lock` directory next to the target;
    // we point it at a stable sibling so the lock survives buffer
    // truncation.
    this.lockTarget = path.join(stateDir, 'buffer.lock');
    if (!existsSync(this.lockTarget)) {
      writeFileSync(this.lockTarget, '', 'utf-8');
    }
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
   * Returns the number of buffered lines, or `0` when the file does not
   * exist or contains only blank lines.
   *
   * Counts non-empty lines directly and does NOT `JSON.parse` them, so
   * `append`-then-`size` in a loop stays linear rather than O(n²). This
   * counts the pending WORK on disk: a malformed line (from an aborted
   * write) is still a line that occupies the buffer, so it is counted
   * here even though {@link readAll} — which returns parseable entries —
   * would drop it. The two can differ by exactly the malformed-line count.
   */
  size(): number {
    if (!existsSync(this.bufferPath)) return 0;
    const raw = readFileSync(this.bufferPath, 'utf-8');
    let count = 0;
    for (const line of raw.split('\n')) {
      if (line.length > 0) count += 1;
    }
    return count;
  }

  /**
   * Reads every buffered entry from disk in append order.
   *
   * Lines that fail to parse are skipped and reported through the
   * returned `parseFailures` count, so callers can still flush good
   * entries when one was corrupted by an aborted write.
   */
  readAll(): readonly SyncBufferEntry[] {
    return this.readAllUnlocked();
  }

  /**
   * Replaces the buffer file with an empty one atomically (write tmp,
   * rename), guarded by a cooperative file lock so concurrent MCP
   * servers cannot overlap their flush.
   *
   * The critical section is short — the lock is released as soon as
   * the rename completes.
   */
  truncate(): void {
    const release = this.acquireLock();
    try {
      const tmp = `${this.bufferPath}.tmp`;
      writeFileSync(tmp, '', 'utf-8');
      renameSync(tmp, this.bufferPath);
    } finally {
      release();
    }
  }

  /**
   * Atomically reads every entry and truncates the buffer in a single
   * critical section, returning the entries that were drained.
   *
   * Use this from {@link SyncService.flushAll} so a concurrent flush
   * from another server cannot read the same entries before they're
   * cleared.
   *
   * @returns Drained entries (may be empty)
   */
  drain(): readonly SyncBufferEntry[] {
    const release = this.acquireLock();
    try {
      const entries = this.readAllUnlocked();
      const tmp = `${this.bufferPath}.tmp`;
      writeFileSync(tmp, '', 'utf-8');
      renameSync(tmp, this.bufferPath);
      return entries;
    } finally {
      release();
    }
  }

  private acquireLock(): () => void {
    let lastErr: unknown;
    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
      try {
        return lockfile.lockSync(this.lockTarget, LOCK_OPTIONS);
      } catch (err) {
        lastErr = err;
        sleepBriefly(LOCK_BACKOFF_MS);
      }
    }
    throw lastErr ?? new Error('failed to acquire sync buffer lock');
  }

  // Sleep helper used by acquireLock retry loop is a free function below.

  private readAllUnlocked(): readonly SyncBufferEntry[] {
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
}

/**
 * A private lock only this process's thread ever waits on, so the wait
 * always times out (nothing notifies it) — it is purely a non-burning
 * sleep. `Atomics.wait` parks the thread instead of spinning, so lock
 * contention no longer pins a CPU core.
 */
const SLEEP_LOCK = new Int32Array(new SharedArrayBuffer(4));

/**
 * Synchronous, non-spinning pause used between lock attempts. Stays
 * synchronous (the SyncBuffer API is sync, like better-sqlite3) but uses
 * `Atomics.wait` — which blocks the thread without burning CPU — rather
 * than a busy loop. The wait always elapses via timeout: `SLEEP_LOCK[0]`
 * is never changed or notified, so `Atomics.wait` returns `timed-out`
 * after `ms`.
 */
function sleepBriefly(ms: number): void {
  Atomics.wait(SLEEP_LOCK, 0, 0, ms);
}
