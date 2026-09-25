/**
 * Mutual exclusion over one tail, for the window between reading its end and
 * appending to it.
 *
 * THE PREMISE THIS FILE FALSIFIES is written at the top of `writer.ts`, and the
 * sentence is quoted here because it is the reason nothing like this existed:
 * "Because each machine writes only its own tail, there is never an in-file merge
 * — concurrency across machines is resolved by reading many tails, not by locking
 * one file." That is true BETWEEN machines and false WITHIN one. Two sessions on
 * the same machine in the same project share the identity, therefore the
 * installation id, therefore the tail — so they are not two machines, they are two
 * writers of one file, and the argument never covered them. Measured, on the built
 * binary: two concurrent `mnema decision` runs corrupted the chain in 15 of 20
 * rounds, each process reading the same `seq` and the same `prev` and appending a
 * second entry at the same logical position. Nothing was LOST — every title
 * survived — but `verify` exited 1 with a `seq gap`, which is the whole product
 * failing at the one thing it sells.
 *
 * ## Why a lock file, and why an advisory one
 *
 * `O_APPEND` already makes the BYTES safe: no line interleaves with another, which
 * is why the damage reads as a clean duplicate rather than shredded JSON. What is
 * unsafe is the read-modify-write around it — a writer reads the tail's last entry
 * for `seq` and `prev`, then appends — and no filesystem offers a compare-and-append
 * that would close it. Node has no `flock` binding, so the portable primitive is the
 * one git uses for `index.lock`: create a file with `O_CREAT | O_EXCL`, which the
 * kernel makes atomic, and treat winning that creation as holding the lock.
 *
 * Advisory, therefore, in the strict sense: it binds the writers that ask. Every
 * entry that reaches a tail in this workspace goes through `ChainWriter`'s two
 * append doors, and both ask here, so "every writer asks" is a property of the
 * module graph rather than a discipline (see the note on `refuseUnreadable`, which
 * relies on the same two doors). A foreign process writing into `tails/` by hand is
 * outside any guarantee this file can make, and it always was.
 *
 * ## What happens when the holder dies
 *
 * A lock that outlives its holder would wedge the tail forever, so a waiter breaks
 * one it can prove is abandoned: the recorded pid is gone, or the record is older
 * than {@link DEFAULT_STALE_MS}. Breaking is itself a race — two waiters could both
 * decide to break, and the second could unlink a lock the first had just taken
 * fresh — so a breaker first `rename`s the file away, which the kernel gives to
 * exactly one of them, and then confirms the bytes it moved are the bytes it judged.
 * If they are not, it puts the file back: it was about to destroy a live lock.
 *
 * ## What it costs when nobody is contending
 *
 * One `open`+`write`, one `close`+`unlink`, per act of appending. It is NOT paid per
 * event: the batch door takes it once for the whole batch, and the writer's own
 * checkpoint takes it once. The number is in the delivery's report.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { sleepSync } from './sleep.js';

/**
 * How long a writer waits for a busy tail before it refuses.
 *
 * Sized against what a holder actually does, not against a guess: a holder keeps the
 * lock for one append (or one batch) plus one checkpoint signature, which is
 * milliseconds, and the longest act the product has — `decision import --write` over
 * a directory of ADRs — takes the lock once per ADR rather than once for the import.
 * So two seconds is three orders of magnitude of headroom, and reaching it means
 * something is genuinely wrong rather than merely busy: that is what makes the
 * refusal worth printing instead of waiting longer.
 *
 * It is also short enough for the refusal to have a TEST that runs in the suite
 * rather than a comment claiming it would fire. A budget a guard cannot afford to
 * wait out is a budget nothing checks.
 */
export const DEFAULT_WAIT_MS = 2_000;

/**
 * How old a lock record may be before a waiter treats it as abandoned even though
 * its pid answers.
 *
 * The pid check is the real test and this is the backstop under it, for the one case
 * the pid cannot decide: a dead holder's pid reused by an unrelated process. It has
 * to be comfortably longer than the longest honest hold, or it would break a lock
 * that is merely working — hence a minute against a hold measured in milliseconds.
 */
export const DEFAULT_STALE_MS = 60_000;

/** How long a waiter sleeps between attempts. */
const POLL_MS = 5;

/**
 * A tail that is being written by somebody else and did not come free.
 *
 * It is a REFUSAL, not a defect, and it is the deterministic half of this delivery's
 * promise: the writes that used to race now either serialize or land here, and which
 * of the two happens is decided by a clock budget rather than by who won a read. The
 * surfaces turn a throw into a reported failure with a non-zero exit (see the
 * catch-all in `code/src/cli.ts`), so the sentence below is what a person reads.
 *
 * It names the holder's pid because the only useful next move is to find it — the
 * common cause is a second window of the same host open on the same project.
 */
export class TailBusyError extends Error {
  readonly code = 'TAIL_BUSY';

  constructor(
    readonly tailLock: string,
    readonly heldBy: number | undefined,
    waitedMs: number,
  ) {
    const holder = heldBy === undefined ? 'another process' : `process ${heldBy}`;
    // THIS WRITE, not "nothing": this said "nothing was appended", which is true of the act
    // the lock refused and not of the call around it — through the agent's server, the call
    // that meets a busy tail may already have opened its session's run on the way in.
    super(
      `this machine's tail is being written by ${holder} and did not come free in ${waitedMs}ms. ` +
        'Two sessions writing the same project at once share one tail; this write was not appended. ' +
        `Lock: ${tailLock}`,
    );
    this.name = 'TailBusyError';
  }
}

/** Knobs the tests turn; production takes the defaults. */
export interface TailLockOptions {
  readonly waitMs?: number;
  readonly staleMs?: number;
}

/**
 * Runs `act` with this tail's lock held, and releases it however `act` ends.
 *
 * The release is in a `finally` for the reason that matters most here: an append
 * that throws — an unreadable event, a waiver the disk does not bear out, a full
 * disk — must not leave the tail wedged for every later writer on this machine. A
 * refusal is not a crash, and it may not behave like one.
 *
 * @throws {TailBusyError} if the lock does not come free inside the budget. Nothing
 * of `act` has run at that point, so the caller's tail is untouched.
 */
export function withTailLock<T>(path: string, act: () => T, options: TailLockOptions = {}): T {
  const fd = acquire(path, options.waitMs ?? DEFAULT_WAIT_MS, options.staleMs ?? DEFAULT_STALE_MS);
  try {
    return act();
  } finally {
    release(fd, path);
  }
}

function acquire(path: string, waitMs: number, staleMs: number): number {
  const deadline = Date.now() + waitMs;
  let heldBy: number | undefined;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      // The record a later waiter judges. Written before the lock is USED, so a
      // waiter never reads an empty file and concludes the holder is nameless.
      writeSync(fd, `${process.pid} ${Date.now()}\n`);
      return fd;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // The tree's `locks/` directory is not there yet, and the first lock the
        // tree ever takes makes it. (This said "the tail directory … a writer makes
        // it in its constructor", from when the lock lived beside the segments; it
        // moved to `locks/` — see `tailLockPath` — and a writer's constructor now
        // makes nothing at all, see `ChainWriter.ensureBorn`.)
        mkdirSync(dirname(path), { recursive: true });
        continue;
      }
      if (code !== 'EEXIST') throw error;
    }
    const held = holderOf(path);
    heldBy = held?.pid;
    if (held !== undefined && breakIfAbandoned(path, held, staleMs)) continue;
    if (Date.now() >= deadline) throw new TailBusyError(path, heldBy, waitMs);
    sleepSync(POLL_MS);
  }
}

function release(fd: number, path: string): void {
  closeSync(fd);
  try {
    unlinkSync(path);
  } catch {
    // Already gone: a waiter judged this lock abandoned and broke it. That is a
    // real outcome (this process was stopped long enough to look dead) and there
    // is nothing to undo — the bytes of every append it made are already on the
    // tail, and the next writer recovers its state from them.
  }
}

/** What a lock file says about its holder, or undefined if it cannot be read. */
interface Holder {
  readonly pid: number;
  readonly since: number;
  /** The exact bytes read, so a breaker can prove it is destroying what it judged. */
  readonly record: string;
}

function holderOf(path: string): Holder | undefined {
  let record: string;
  try {
    record = readFileSync(path, 'utf-8');
  } catch {
    return undefined; // vanished between the failed create and this read: retry
  }
  const [pidText, sinceText] = record.trim().split(' ');
  const pid = Number.parseInt(pidText ?? '', 10);
  const since = Number.parseInt(sinceText ?? '', 10);
  if (!Number.isFinite(pid)) return undefined;
  return { pid, since: Number.isFinite(since) ? since : 0, record };
}

/**
 * Breaks a lock whose holder is provably gone. Returns true if the caller should
 * try to take it again — either because this broke it, or because it moved under us
 * and the situation is worth re-reading.
 */
function breakIfAbandoned(path: string, held: Holder, staleMs: number): boolean {
  const abandoned = !alive(held.pid) || Date.now() - held.since > staleMs;
  if (!abandoned) return false;
  // `rename` is the atomic claim: of two waiters that both judged this lock
  // abandoned, exactly one moves the file, and the other's rename fails.
  const claim = `${path}.${process.pid}.breaking`;
  try {
    renameSync(path, claim);
  } catch {
    return true; // somebody else moved it first; go round again
  }
  try {
    const moved = readFileSync(claim, 'utf-8');
    if (moved === held.record) {
      unlinkSync(claim);
      return true;
    }
    // Different bytes: between the judgement and the rename the old lock was
    // released and a LIVE holder took a fresh one. Put it back — breaking it would
    // be exactly the corruption this file exists to prevent.
    renameSync(claim, path);
  } catch {
    // Best effort: the claim is a uniquely-named file this process owns, so the
    // worst residue is one stray path that no reader looks at.
  }
  return true;
}

/** Whether a pid exists. `EPERM` means it does and belongs to somebody else. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
