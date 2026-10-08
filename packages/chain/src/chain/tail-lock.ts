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
 * A lock that outlives its holder would wedge the tail forever, so a waiter breaks one
 * whose recorded pid is gone, and ONLY that: a pid that answers is a holder, however long
 * it has held. An age limit used to break a live holder after a minute, to recover a lock
 * whose dead owner's pid had been reused; the cost was that a holder alive and merely slow
 * (a stopped process, a suspended laptop) lost the lock to the next waiter and the two then
 * wrote one tail, which is the corruption the lock exists to prevent. The cost of the
 * choice made now is the other case: a reused pid keeps the tail busy, with nobody to
 * clear it, so the refusal names the pid and the lock file and says what to do.
 * `tail-lock.test.ts` fixes both judgements as cases.
 *
 * A lock file that names NO pid is judged by its age instead. A holder writes its record in
 * the instant after it creates the file, so an empty or unreadable one is a holder that died
 * in that instant, or a file a power cut left at zero bytes. This said nothing about it and
 * the waiter judged nothing: measured, an empty lock refused every write at 2 s, and again
 * five seconds later, and would have for ever. Now one older than
 * {@link UNREADABLE_LOCK_ABANDONED_MS} is broken as abandoned, through the same claim below,
 * which puts it back if the holder wrote its record meanwhile. Breaking is itself a race — two waiters could both
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
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { CodedError } from './coded-error.js';
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
 * THAT HEADROOM NO LONGER HOLDS FOR EVERY HOLDER. A move judged on the record now
 * decides under this lock (`ChainWriter.exclusively`, and `onTheRecordAsItStands` in
 * the core), and one that finds the chain moved since it read re-reads the whole
 * record while holding it: 0.10 s at 10 thousand events, 0.36 s at 30 thousand, 1.35 s
 * at 100 thousand. Three sessions moving at once can then leave the third waiting past
 * this budget — measured on the binary, three moves of three decisions at once: 1 of 3
 * tries at 50 thousand events, 3 of 3 at 75 and at 100 thousand, none at 30. The
 * number is unchanged here, because changing it is one of the answers to that cost and
 * the choice among them is not this file's.
 *
 * It is also short enough for the refusal to have a TEST that runs in the suite
 * rather than a comment claiming it would fire. A budget a guard cannot afford to
 * wait out is a budget nothing checks.
 */
export const DEFAULT_WAIT_MS = 2_000;

/**
 * How old a lock file that names no pid must be before a waiter breaks it as abandoned.
 *
 * The holder it could wrong is one stopped between creating the file and writing the line
 * after it — a window of microseconds — for longer than this. Ten seconds is far past any
 * stall of a live process in that window, and the cost of the margin is said plainly: after
 * a crash in that instant, writes wait and refuse for up to ten seconds before the next one
 * heals the tail. Wronging a live holder would put two writers on one tail; waiting does not.
 */
export const UNREADABLE_LOCK_ABANDONED_MS = 10_000;

/** How long a waiter sleeps between attempts. */
const POLL_MS = 5;

/**
 * A tail that is being written by somebody else and did not come free.
 *
 * It is a REFUSAL, not a defect, and it is the deterministic half of this delivery's
 * promise: the writes that used to race now either serialize or land here, and which
 * of the two happens is decided by a clock budget rather than by who won a read. The
 * surfaces turn a throw into a reported failure with a non-zero exit (see the
 * catch-all in `code/src/program.ts`), so the sentence below is what a person reads.
 *
 * It names the holder's pid because the only useful next move is to find it — the
 * common cause is a second window of the same host open on the same project.
 */
export class TailBusyError extends CodedError {
  readonly code = 'TAIL_BUSY';

  constructor(
    readonly tailLock: string,
    readonly heldBy: number | undefined,
    waitedMs: number,
  ) {
    const holder = heldBy === undefined ? 'another process' : `process ${heldBy}`;
    // A live pid is never overruled, so a pid reused by an unrelated process keeps the tail
    // busy: the sentence says how to clear it, because nothing else will.
    // THIS WRITE, not "nothing": this said "nothing was appended", which is true of the act
    // the lock refused and not of the call around it — through the agent's server, the call
    // that meets a busy tail may already have opened its session's run on the way in.
    super(
      `this machine's tail is being written by ${holder} and did not come free in ${waitedMs}ms. ` +
        'Two sessions writing the same project at once share one tail; this write was not appended. ' +
        `Lock: ${tailLock}. If that process is not a mnema session that is still working, ` +
        'delete the lock file and try again.',
    );
    this.name = 'TailBusyError';
  }
}

/** Knobs the tests turn; production takes the defaults. */
export interface TailLockOptions {
  readonly waitMs?: number;
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
  const fd = acquire(path, options.waitMs ?? DEFAULT_WAIT_MS);
  try {
    return act();
  } finally {
    release(fd, path);
  }
}

function acquire(path: string, waitMs: number): number {
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
    if (held !== undefined && breakIfAbandoned(path, held)) continue;
    if (Date.now() >= deadline) throw new TailBusyError(path, heldBy, waitMs);
    sleepSync(POLL_MS);
  }
}

function release(fd: number, path: string): void {
  closeSync(fd);
  try {
    unlinkSync(path);
  } catch {
    // Already gone: somebody removed the file under us (a person clearing a lock they took for
    // a reused pid's, or a breaker that judged a previous owner dead). There
    // is nothing to undo — the bytes of every append it made are already on the
    // tail, and the next writer recovers its state from them.
  }
}

/** What a lock file says about its holder, or undefined if it is gone. */
interface Holder {
  /** The holder's pid, or undefined when the file names none (empty, or not a record). */
  readonly pid: number | undefined;
  readonly since: number;
  /** The exact bytes read, so a breaker can prove it is destroying what it judged. */
  readonly record: string;
  /** How long ago the file was last written, by its mtime: what judges a file with no pid. */
  readonly ageMs: number;
  /**
   * WHICH FILE was judged — its inode and its mtime to the nanosecond — so a breaker can prove the
   * file it moved is that one and not a fresh lock with the same bytes. Two empty locks have the
   * same bytes, so the record alone cannot tell them apart.
   */
  readonly identity: string;
}

/** The inode and nanosecond mtime of a file: what tells one lock file from the next. */
function identityOf(path: string): string {
  const stat = statSync(path, { bigint: true });
  return `${stat.ino}:${stat.mtimeNs}`;
}

function holderOf(path: string): Holder | undefined {
  let record: string;
  let written: number;
  let identity: string;
  try {
    // Read, THEN stat: a holder that writes its record between the two leaves a fresh mtime,
    // so an empty read is never judged old on the strength of a stamp taken before it.
    record = readFileSync(path, 'utf-8');
    const stat = statSync(path, { bigint: true });
    written = Number(stat.mtimeMs);
    identity = `${stat.ino}:${stat.mtimeNs}`;
  } catch {
    return undefined; // vanished between the failed create and this read: retry
  }
  const ageMs = Date.now() - written;
  const [pidText, sinceText] = record.trim().split(' ');
  const pid = Number.parseInt(pidText ?? '', 10);
  const since = Number.parseInt(sinceText ?? '', 10);
  if (!Number.isFinite(pid)) return { pid: undefined, since: 0, record, ageMs, identity };
  return { pid, since: Number.isFinite(since) ? since : 0, record, ageMs, identity };
}

/**
 * Breaks a lock whose holder's pid is gone, or whose file names no pid and is older than
 * {@link UNREADABLE_LOCK_ABANDONED_MS}, and no other. A pid that answers is a live holder however
 * old its record is: taking the lock from it would put two writers on one tail.
 * Returns true if the caller should try to take it again — either because this broke it, or
 * because it moved under us and the situation is worth re-reading.
 */
function breakIfAbandoned(path: string, held: Holder): boolean {
  const abandoned =
    held.pid === undefined ? held.ageMs >= UNREADABLE_LOCK_ABANDONED_MS : !alive(held.pid);
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
    if (moved === held.record && identityOf(claim) === held.identity) {
      unlinkSync(claim);
      return true;
    }
    // Different bytes, or the same bytes in a different file: between the judgement and the
    // rename the old lock was released — or broken by another waiter — and a LIVE holder took
    // a fresh one. Two empty locks read alike, so only the file's identity tells them apart
    // (measured: without it, a waiter that judged an old empty lock renamed and deleted the
    // fresh empty lock of a live holder, and two writers held one tail). Put it back —
    // breaking it would be exactly the corruption this file exists to prevent.
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
