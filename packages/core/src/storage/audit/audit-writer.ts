import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import lockfile from 'proper-lockfile';

import type { AuditStateRepository } from '../sqlite/repositories/audit-state-repository.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '../sqlite/sqlite-adapter.js';
import { orderedAuditFiles } from './audit-files.js';
import { EVENT_FORMAT_VERSION, hmacEvent } from './audit-hash.js';
import type { AuditEvent, HeadCheckpointer, SignedHeadListener } from './audit-types.js';

/**
 * Cross-process lock policy for the chained write path. Mirrors the sync
 * buffer's: `lockSync` takes no retries option, so we drive ten attempts
 * with 50ms backoff. The critical section (one SQLite transaction + one
 * append) is sub-millisecond, so the worst-case wait stays well under 1s.
 */
const LOCK_MAX_ATTEMPTS = 10;
const LOCK_BACKOFF_MS = 50;

/**
 * The critical section holds this lock across a SQLite write, and that write
 * can itself block on the WAL writer for up to {@link SQLITE_BUSY_TIMEOUT_MS}.
 * `lockSync` runs no async mtime auto-update, so the stale threshold must sit
 * ABOVE the longest legitimate hold — otherwise a process legitimately waiting
 * out `busy_timeout` could have its lock judged stale and stolen by a peer,
 * letting two writers into the section at once. Derive it from the busy timeout
 * (plus headroom) so the two constants can never drift into that overlap.
 * `onCompromised` must not throw — contention is handled by the retry loop.
 */
export const LOCK_STALE_MS = SQLITE_BUSY_TIMEOUT_MS + 3000;
const LOCK_OPTIONS = {
  stale: LOCK_STALE_MS,
  realpath: false,
  onCompromised: () => {
    /* handled cooperatively by the acquire retry loop; do not throw */
  },
} as const;

// AuditEvent moved to ./audit-types.ts (leaf) to clear the last madge
// type-cycle; re-exported here so existing importers keep working.
export type { AuditEvent } from './audit-types.js';

/**
 * Append-only writer for one machine's audit tail in JSONL format.
 *
 * Each machine writes ONLY its own tail directory (`audit/m-<id>/`), so the
 * git union-merge can never interleave two machines' lines. The writer is
 * agnostic about that: it is handed the tail directory as its `auditDir` and
 * keeps its files directly under it:
 * - `current.jsonl` for the current month
 * - `YYYY-MM.jsonl` for archived months
 *
 * Rotation happens at write time: if the current file's mtime points to
 * a different month than `now()`, it is renamed to `YYYY-MM.jsonl` and
 * a fresh `current.jsonl` is started.
 *
 * The writer (1) chains lines via `prev_hash`/`hash`, (2) seals each line
 * with the per-project HMAC secret, and (3) mirrors this tail's event count,
 * last `at`, and chain-head hash into SQLite. Every write is chained and
 * keyed — there is no unkeyed path.
 */
export class AuditWriter {
  private readonly currentFile: string;
  private readonly lockTarget: string;
  private readonly now: () => Date;
  /** Cached result of the lazy secret provider, resolved on first write. */
  private secretResolved = false;
  private secret: Buffer | null = null;

  /**
   * Initialises the writer. Creates the audit directory if needed and
   * triggers an immediate rotation check so the very first write lands
   * in the right month.
   *
   * @param auditDir - Absolute path to this machine's tail directory
   *   (`audit/m-<id>/`); the writer's files live directly under it
   * @param state - SQLite mirror backing this tail's chain and its invariants
   * @param now - Optional clock; defaults to `() => new Date()`
   * @param secretProvider - Lazy source of the per-project HMAC secret.
   *   Resolved on the FIRST write (not at construction), so a read-only
   *   command that never writes neither generates a secret nor writes the
   *   committed fingerprint. It must yield a secret at write time — a write
   *   with no secret available is refused; there is no unkeyed fallback.
   * @param headCheckpoint - Optional machine-attestation signer. Called
   *   once AFTER each committed chain advance (still under the write lock,
   *   off the per-event hot path in the sense that it signs at most once
   *   per checkpoint interval, not once per event). `null` disables head
   *   signing.
   * @param anchorScheduler - Optional temporal-anchoring scheduler. When a
   *   checkpoint signs a new head, it is handed here AFTER the write lock is
   *   released; the scheduler records it pending and stamps asynchronously,
   *   fail-open. `null` disables anchoring.
   */
  constructor(
    private readonly auditDir: string,
    private readonly state: AuditStateRepository,
    private readonly secretProvider: () => Buffer | null,
    now: () => Date = () => new Date(),
    private readonly headCheckpoint: HeadCheckpointer | null = null,
    private readonly anchorScheduler: SignedHeadListener | null = null,
    // Fire-and-forget hook invoked (outside the lock) when a checkpoint signs a
    // new head, so the attestation layer can materialise the `.att` for the
    // freshly-closed batch off the hot path. `null` disables auto-attestation
    // (the `reattest` command remains the manual/repair path). Injected as a
    // callback so the writer stays free of the attestation modules.
    private readonly onCheckpoint: ((head: string, eventCount: number) => void) | null = null,
  ) {
    this.now = now;
    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }
    this.currentFile = path.join(auditDir, 'current.jsonl');
    this.lockTarget = path.join(auditDir, '.audit.lock');
    // The write path takes a cross-process lock; the startup rotation shares
    // it so two processes booting across a month boundary cannot race the
    // rename.
    if (!existsSync(this.lockTarget)) writeFileSync(this.lockTarget, '', 'utf-8');
    const release = this.acquireLock();
    try {
      this.checkRotation();
      // Recover from a crash in the commit→append window: if the mirror is
      // one event ahead of the on-disk tail (a committed head whose line
      // never landed), rewind it to the real tail so the next write chains
      // from a line that exists — otherwise it would fork the chain onto a
      // phantom head. Done under the same boot lock as rotation.
      this.reconcileMirror();
    } finally {
      release();
    }
  }

  /**
   * Rewinds the SQLite mirror to the real on-disk chain tail when a crash
   * left it exactly one event ahead. Delegates the exact-shape check + rewind
   * to the repository, which only acts on the recoverable one-ahead case; a
   * genuine truncation is separately caught by the attestation layer
   * (a signed checkpoint above the rewound count is flagged as a rollback).
   *
   * The whole tail is counted (all rotated segments + current), not just
   * `current.jsonl`: the mirror's `event_count` tracks this machine's tail, so
   * the one-ahead comparison needs its full count. The tail hash/at always
   * come from the last chained line (the crash only ever drops the current
   * tail). This is one boot-time scan, under the write lock — the same cost
   * `doctor` already pays, run once per process start.
   */
  private reconcileMirror(): void {
    let count = 0;
    let tailHash: string | null = null;
    let tailAt: string | null = null;
    for (const file of orderedAuditFiles(this.auditDir)) {
      for (const line of readFileSync(file, 'utf-8').split('\n')) {
        if (line.length === 0) continue;
        let event: { v?: number; hash?: unknown; at?: unknown };
        try {
          event = JSON.parse(line);
        } catch {
          continue; // malformed line: not a chained event
        }
        if (typeof event.v === 'number' && event.v === EVENT_FORMAT_VERSION) {
          count += 1;
          tailHash = typeof event.hash === 'string' ? event.hash : null;
          tailAt = typeof event.at === 'string' ? event.at : null;
        }
      }
    }
    this.state.reconcileToDisk(count, tailHash, tailAt);
  }

  /**
   * Appends an event to `current.jsonl`, performing a rotation check first.
   *
   * Fills in `prev_hash` from the SQLite mirror, computes `hash`, writes the
   * line, and advances the mirror in a single sequence. The order matters:
   * the line on disk includes the hash that the mirror records, so a
   * subsequent doctor walk re-computes the same hash and matches.
   *
   * @param event - Event to append (will be JSON-serialised on a single line)
   */
  write(event: AuditEvent): void {
    // A cross-process file lock wraps the WHOLE critical section —
    // rotation, the SQLite transaction, AND the post-commit append. The
    // SQLite `BEGIN IMMEDIATE` inside `withChainAdvance` only serialises
    // the mirror update; it does NOT order the append, which runs after
    // COMMIT. Without this outer lock, two processes could commit in one
    // order (A then B) but append in the other (B's line first), forking
    // the on-disk chain so `mnema doctor` reads a benign concurrent write
    // as a `prev_hash` break — false tampering. Holding the lock across
    // the append forces B to wait until A's line is on disk.
    //
    // Crash-safety from the post-commit append is preserved: the line is
    // still appended only AFTER the commit, so a crash between the two
    // leaves the mirror one event ahead of disk (recoverable), never a
    // line the committed mirror did not record.
    // Resolve the secret lazily on the first write (never at construction),
    // so a read-only command that never writes does not mint a secret or
    // the committed fingerprint.
    const secret = this.resolveSecret();
    // Mandatory-keyed (AUD-2): a machine with no project secret REFUSES to
    // seal rather than degrade to a weaker keyless line. The only event
    // format is HMAC-keyed, so a write with no secret cannot be authenticated
    // by anyone and must never masquerade as a chained line. Fail closed
    // with an actionable message pointing at the secret import.
    if (secret === null) {
      throw new Error(
        'cannot seal an audit event: the project secret is not available on this machine. ' +
          'Import it with `mnema project secret import` before writing (see .mnema/keys).',
      );
    }
    // Set by the checkpoint below when a new head is signed; consumed after
    // the lock is released to kick off anchoring off the write path.
    let signedHead: { hash: string; eventCount: number } | null = null;
    const release = this.acquireLock();
    try {
      this.state.withChainAdvance((currentHead) => {
        this.checkRotation();
        // The single event format is HMAC-keyed and project-authentic
        // end to end. The secret is guaranteed present here (mandatory-keyed
        // check above), so every sealed line is keyed.
        const chained: AuditEvent = {
          ...event,
          v: EVENT_FORMAT_VERSION,
          prev_hash: currentHead,
        };
        const hash = hmacEvent(chained, secret);
        const sealed: AuditEvent = { ...chained, hash };
        const line = `${JSON.stringify(sealed)}\n`;
        return {
          hash,
          at: sealed.at,
          afterCommit: () => appendFileSync(this.currentFile, line, { flag: 'a' }),
        };
      });

      // Machine attestation, off the per-event hot path: sign the freshly
      // committed head at most once per checkpoint interval. Held under the
      // same write lock so two processes cannot race the signature; the
      // signer itself no-ops between checkpoints, so the per-event cost is a
      // single read-and-compare, not a signing call.
      if (this.headCheckpoint !== null) {
        const { chainHeadHash, eventCount } = this.state.read();
        if (chainHeadHash !== null) {
          const sig = this.headCheckpoint.maybeSign(chainHeadHash, eventCount);
          if (sig !== null) signedHead = { hash: sig.coveredHeadHash, eventCount };
        }
      }
    } finally {
      release();
    }

    // Temporal anchoring runs OUTSIDE the write lock and is fire-and-forget:
    // when a new head was just signed, hand it to the scheduler, which
    // records it pending and stamps asynchronously (fail-open) — but only
    // once the configured anchor interval has elapsed. The write has already
    // returned by the time any network I/O happens.
    if (signedHead !== null && this.anchorScheduler !== null) {
      this.anchorScheduler.onSignedHead(signedHead.hash, signedHead.eventCount);
    }
    // Auto-attestation (ADR-41): materialise the `.att` for the batch a
    // checkpoint just closed, off the write lock. Same fire-and-forget,
    // fail-open discipline as anchoring — a failure here must never surface to
    // the write that already succeeded; `reattest` can always backfill.
    if (signedHead !== null && this.onCheckpoint !== null) {
      try {
        this.onCheckpoint(signedHead.hash, signedHead.eventCount);
      } catch (error) {
        // Fail-open: the write already stood, and `reattest` can backfill any
        // batch this skipped. But do NOT swallow silently — the benign cases
        // (no signer, unhealthy chain) already return WITHOUT throwing inside
        // autoAttest, so anything reaching here is UNEXPECTED (a bug, ENOSPC,
        // EACCES). A fully silent catch would let auto-attestation stop
        // emitting forever with no signal, quietly eroding the very coverage
        // this feature adds. Surface it on stderr so it is diagnosable.
        process.stderr.write(
          `mnema: auto-attestation skipped (write unaffected): ${(error as Error).message}\n`,
        );
      }
    }
  }

  /**
   * Resolves the per-project secret once, on first write, caching the
   * result (including `null`). Calling the provider lazily is what keeps a
   * read-only command from generating the secret + fingerprint.
   */
  private resolveSecret(): Buffer | null {
    if (!this.secretResolved) {
      this.secret = this.secretProvider();
      this.secretResolved = true;
    }
    return this.secret;
  }

  /**
   * Acquires the cross-process audit lock, retrying on contention.
   * `proper-lockfile.lockSync` takes no retries option, so the loop is
   * explicit. Returns the release function.
   */
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
    throw lastErr ?? new Error('failed to acquire audit lock');
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
   *
   * Fails closed if the destination archive already exists: `renameSync`
   * would otherwise clobber it atomically, silently destroying a whole
   * archived month of the chain (which can happen on clock skew, a second
   * rotation for the same month, or a restored archive). Refusing to
   * overwrite is safer than losing append-only history — the caller can
   * reconcile the collision by hand.
   */
  checkRotation(): void {
    if (!existsSync(this.currentFile)) return;

    const currentMonth = monthKey(this.now());
    const fileMonth = monthKey(statSync(this.currentFile).mtime);
    if (fileMonth === currentMonth) return;

    const target = path.join(this.auditDir, `${fileMonth}.jsonl`);
    if (existsSync(target)) {
      throw new Error(
        `audit rotation refused: ${path.basename(target)} already exists — ` +
          'refusing to overwrite an archived month. Reconcile the collision manually.',
      );
    }
    renameSync(this.currentFile, target);
  }
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Short synchronous backoff for the lock retry loop. The write path is
 * synchronous, so this must block without an event-loop turn — but it must
 * NOT busy-spin: a tight `while (Date.now() < end)` pins a full CPU core for
 * the whole backoff and, under contention, starves the very process holding
 * the lock (which needs the CPU to finish its sub-ms critical section and
 * release). `Atomics.wait` on a private buffer blocks the thread for `ms`
 * without burning CPU, staying fully synchronous. It always times out (the
 * value never changes), so it is a pure sleep.
 */
function sleepBriefly(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
