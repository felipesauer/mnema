/**
 * Two writers of ONE tail.
 *
 * The defect these cases exist for is a read-modify-write: a writer reads the tail's
 * last entry for `seq` and `prev` and then appends, and a second writer that read the
 * same end appends at the same logical position. Measured on the built binary before
 * the fix — two concurrent `mnema decision` runs corrupted the chain in 15 of 20
 * rounds, and two MCP sessions calling `record_observation` in 10 of 10.
 *
 * ## Why these cases are not a race
 *
 * A test that spawns two processes and hopes to hit the window is a probe with a
 * PROBABILITY, and this workspace has paid for asserting one of those. The hazard,
 * however, is not the concurrency — it is the STALE STATE the concurrency produces,
 * and two writers in one process reproduce that exactly and every time: open both,
 * let the first append, then let the second append from the end it read before. On
 * the base that is a duplicate `seq` in 100% of runs, not 75%.
 *
 * The rounds-and-rates form still exists, because it is what proves the fix on the
 * real binary through the real transports.
 *
 * The other half — that a tail already held by somebody else is REFUSED rather than
 * waited on forever, and that a lock outliving its holder is broken rather than
 * wedging the tail — is tested against the lock itself, with a holder this file
 * plants.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, taskCreated } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';
import { tailDir, tailLockPath } from './layout.js';
import { readTailCheckpoints, readTailEntries } from './store.js';
import {
  DEFAULT_WAIT_MS,
  TailBusyError,
  UNREADABLE_LOCK_ABANDONED_MS,
  withTailLock,
} from './tail-lock.js';
import type { ChainWriter } from './writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-tail-lock-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const upcasters = catalogUpcasters();

const env = (w: ChainWriter, subject: string) => ({
  at: '2026-09-15T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

/** A writer on the shared tail. Every one of these lands on the SAME tail id. */
function openWriter(opts?: { maxUnsignedEvents?: number; maxSegmentBytes?: number }): ChainWriter {
  return openChainForWriting(root, { keyRoot: root, ...opts });
}

/** Founds the anchor so `verify` can reach green, and returns the writer. */
function founded(opts?: { maxUnsignedEvents?: number; maxSegmentBytes?: number }): ChainWriter {
  const w = openWriter(opts);
  w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
  return w;
}

const task = (w: ChainWriter, id: string) =>
  taskCreated(env(w, `t-${id}`), { title: `task ${id}` });

function tailIdOf(): string {
  const w = openWriter();
  return w.tail;
}

/** Every entry of the one tail, in stored order. */
function entries() {
  return readTailEntries({ root }, tailIdOf(), upcasters);
}

describe('two writers of one tail do not write over each other', () => {
  it('does not put two entries at the same seq', () => {
    const first = founded();
    // BOTH open before either appends: this is the stale read, and it is what a
    // second window of the host does when it opens a session on the same project.
    const second = openWriter();

    first.append(task(first, 'a'));
    second.append(task(second, 'b'));

    const seqs = entries().map((entry) => entry.link.seq);
    expect(seqs).toStrictEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toStrictEqual([0, 1, 2]);
  });

  it('chains the second writer onto what is ON the tail, not onto the end it read', () => {
    const first = founded();
    const second = openWriter();

    first.append(task(first, 'a'));
    const late = second.append(task(second, 'b'));

    const all = entries();
    const before = all[all.length - 2];
    expect(late.link.prev).toBe(before?.link.hash);
    // And the whole record still verifies — the assertion above could hold over a
    // chain broken somewhere else.
    expect(verify(root, upcasters).ok).toBe(true);
  });

  it('keeps a batch whole when another writer appends between its two acts', () => {
    const first = founded();
    const second = openWriter();

    first.appendAll([task(first, 'a1'), task(first, 'a2')]);
    second.appendAll([task(second, 'b1'), task(second, 'b2')]);
    first.appendAll([task(first, 'a3'), task(first, 'a4')]);

    const seqs = entries().map((entry) => entry.link.seq);
    expect(seqs).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(verify(root, upcasters).ok).toBe(true);
  });

  it('does not sign a range another writer has already signed', () => {
    // A cadence that never fires on its own, so the checkpoints below are exactly
    // the ones these lines ask for.
    const first = founded({ maxUnsignedEvents: 10_000 });
    const second = openWriter({ maxUnsignedEvents: 10_000 });

    first.append(task(first, 'a'));
    second.append(task(second, 'b'));
    first.checkpoint();
    second.checkpoint();

    const covered = readTailCheckpoints({ root }, tailIdOf()).map((cp) => [cp.fromSeq, cp.toSeq]);
    // Contiguous and non-overlapping: the coverage the verifier demands. Without the
    // resynchronisation the second checkpoint re-signs from 0 and verify reads the
    // tail as tampered.
    let expected = 0;
    for (const [from, to] of covered) {
      expect(from).toBe(expected);
      expected = (to as number) + 1;
    }
    expect(verify(root, upcasters).ok).toBe(true);
  });

  it('notices the other writer rolling onto a segment this one does not know about', () => {
    // THE CASE THE FIRST DRAFT OF THIS FILE DID NOT HAVE, and it was the mutation
    // that found it: blinding the mark to a new segment left 0 tests red. The
    // doc-comment on `TailMark` argued the case was unreachable — "a roll is always
    // PRECEDED by growth we would have seen" — and that is false. The growth that
    // pushes a segment over its cap happens BEFORE this writer's mark is taken, so
    // the other writer's next append lands in a segment whose birth is the only
    // trace: the segment we are watching does not change size at all.
    //
    // A cap of one byte makes every append roll, which is what puts three acts
    // inside that window instead of four million.
    const a = founded({ maxSegmentBytes: 1, maxUnsignedEvents: 10_000 });
    const b = openWriter({ maxSegmentBytes: 1, maxUnsignedEvents: 10_000 });

    a.append(task(a, 'a1')); // rolls: lands in a segment of its own
    b.append(task(b, 'b1')); // rolls again, in a segment `a` has never seen
    a.append(task(a, 'a2')); // only a NEW SEGMENT says the tail moved

    const seqs = entries().map((entry) => entry.link.seq);
    expect(seqs).toStrictEqual([0, 1, 2, 3]);
    expect(verify(root, upcasters).ok).toBe(true);
  });

  it('interleaves many acts of two writers without a break', () => {
    const a = founded();
    const b = openWriter();
    for (let n = 0; n < 12; n += 1) {
      a.append(task(a, `a${n}`));
      b.append(task(b, `b${n}`));
    }
    const seqs = entries().map((entry) => entry.link.seq);
    expect(seqs).toStrictEqual(Array.from({ length: 25 }, (_, n) => n));
    expect(verify(root, upcasters).ok).toBe(true);
  });
});

describe('the lock a writer holds while it appends', () => {
  /**
   * Plants a lock file naming a holder of our choosing. The directory is already
   * there: every writer these cases start from has appended once, and appending is
   * what creates it.
   */
  function plantAt(path: string, pid: number, since: number): void {
    writeFileSync(path, `${pid} ${since}\n`, 'utf-8');
  }

  /**
   * THE ONE CASE IN THIS WORKSPACE WITH A CEILING OF ITS OWN, and the line says what it
   * waits on: a lock held by a process that is alive and stays alive, which is a wait the
   * writer is SUPPOSED to serve out. It appends twice — once for the refusal and once for
   * what the refusal says — so it spends two full `DEFAULT_WAIT_MS` of 2000 ms by design.
   *
   * Measured by `pnpm why-it-went-red`: 4044 ms inside the suite and 4018 ms with the
   * machine to itself, against a shared ceiling of 5000 ms. So it was not failing — it was
   * spending four fifths of everybody's ceiling while declaring nothing, which is the
   * reading `.github/why-it-went-red/` calls WAITS WITHOUT SAYING SO, and it was reported
   * on every run. A case one second from a ceiling it never declared is a red waiting for a
   * busy minute.
   *
   * 20000 ms is five times the 4000 ms it waits on purpose. The margin is sized from the
   * spread that same ban measured rather than guessed: two runs of one commit on one image
   * differed more than two machines did, and coverage instrumentation charges 1.48x to the
   * heaviest case.
   */
  it('refuses a tail a live process is holding, and appends nothing', { timeout: 20_000 }, () => {
    const w = founded();
    const before = entries().length;
    const lock = tailLockPath({ root }, w.tail);
    // A holder that is alive and fresh: this very process. Nothing may break it.
    plantAt(lock, process.pid, Date.now());

    expect(() => w.append(task(w, 'refused'))).toThrow(TailBusyError);
    expect(entries().length).toBe(before);
    // The refusal names the holder, because finding it is the only useful next move.
    try {
      w.append(task(w, 'refused'));
    } catch (error) {
      expect((error as TailBusyError).code).toBe('TAIL_BUSY');
      expect((error as Error).message).toContain(String(process.pid));
      // And says what to do about it: the lock file is named, and deleting it is the way out.
      expect((error as Error).message).toContain(lock);
      expect((error as Error).message).toContain('delete the lock file');
    }
    rmSync(lock);
  });

  it('breaks a lock whose holder is gone rather than wedging the tail', () => {
    const w = founded();
    const lock = tailLockPath({ root }, w.tail);
    // A pid no process can have: `kill(0)` answers ESRCH, so the holder is provably
    // gone and the wait does not have to be served out.
    plantAt(lock, 0x7fffffff, Date.now());

    const started = Date.now();
    w.append(task(w, 'after-a-kill'));
    expect(Date.now() - started).toBeLessThan(DEFAULT_WAIT_MS);
    expect(entries().length).toBe(2);
    expect(verify(root, upcasters).ok).toBe(true);
  });

  it('does not break a lock whose holder is alive, however long it has held it', {
    timeout: 20_000,
  }, () => {
    const w = founded();
    const before = entries().length;
    const lock = tailLockPath({ root }, w.tail);
    // A LIVE pid — ours — whose record is ten minutes old: a holder that is alive and slow
    // (a stopped process, a suspended laptop). Breaking it would put two writers on one tail,
    // which is the corruption the lock exists to prevent, so the writer waits and refuses.
    plantAt(lock, process.pid, Date.now() - 10 * 60_000);

    expect(() => w.append(task(w, 'after-a-slow-hold'))).toThrow(TailBusyError);
    expect(entries().length).toBe(before);
    expect(existsSync(lock)).toBe(true);
    rmSync(lock);
  });

  it('breaks a lock file that names no pid once it is older than the limit', () => {
    const w = founded();
    const lock = tailLockPath({ root }, w.tail);
    // What a holder killed between creating the file and writing its line leaves, and what a
    // power cut leaves at zero bytes: no pid to ask. Stamped past the limit, it is abandoned.
    writeFileSync(lock, '');
    const old = (Date.now() - UNREADABLE_LOCK_ABANDONED_MS - 1_000) / 1000;
    utimesSync(lock, old, old);

    const started = Date.now();
    w.append(task(w, 'after-an-empty-lock'));
    expect(Date.now() - started).toBeLessThan(DEFAULT_WAIT_MS);
    expect(entries().length).toBe(2);
    expect(existsSync(lock)).toBe(false);
  });

  it('does not break the fresh empty lock of a live holder that took the old one\u2019s place', {
    timeout: 20_000,
  }, () => {
    const w = founded();
    const before = entries().length;
    const lock = tailLockPath({ root }, w.tail);
    writeFileSync(lock, '');
    const old = (Date.now() - UNREADABLE_LOCK_ABANDONED_MS - 1_000) / 1000;
    utimesSync(lock, old, old);
    // THE ABA. This writer judges the old empty lock abandoned; before its claim lands, another
    // waiter breaks that same lock and takes the tail with a fresh one it has not written its
    // line into yet. Both files are empty, so the bytes this writer compares are the same.
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
    const rename = fs.renameSync;
    let raced = false;
    fs.renameSync = (from, to) => {
      if (!raced && String(to).endsWith('.breaking')) {
        raced = true;
        fs.unlinkSync(lock);
        fs.writeFileSync(lock, '', { flag: 'wx' });
      }
      rename(from, to);
    };
    syncBuiltinESMExports();
    try {
      // The fresh lock is young and names nobody: the writer waits it out and refuses.
      expect(() => w.append(task(w, 'beside-a-fresh-holder'))).toThrow(TailBusyError);
    } finally {
      fs.renameSync = rename;
      syncBuiltinESMExports();
    }
    expect(raced).toBe(true);
    expect(existsSync(lock)).toBe(true);
    expect(entries().length).toBe(before);
    rmSync(lock);
  });

  it('does not break a lock file that names no pid while it is young', { timeout: 20_000 }, () => {
    const w = founded();
    const before = entries().length;
    const lock = tailLockPath({ root }, w.tail);
    // Just created and not yet written: the instant a live holder is in before its record.
    writeFileSync(lock, '');

    expect(() => w.append(task(w, 'beside-a-young-empty-lock'))).toThrow(TailBusyError);
    expect(entries().length).toBe(before);
    expect(existsSync(lock)).toBe(true);
    rmSync(lock);
  });

  it('signs with no wait when there is nothing to sign, however busy the tail is', () => {
    const w = founded();
    w.checkpoint();
    const lock = tailLockPath({ root }, w.tail);
    // A live holder: a checkpoint that asked for the lock would wait it out and refuse — after
    // the write it follows had already landed, which is the refusal that said "not appended".
    plantAt(lock, process.pid, Date.now());

    const started = Date.now();
    expect(w.checkpoint()).toBeNull();
    expect(Date.now() - started).toBeLessThan(DEFAULT_WAIT_MS);
    rmSync(lock);
  });

  it('still asks for the lock to sign what another writer left on the tail', {
    timeout: 20_000,
  }, () => {
    const w = founded();
    w.checkpoint();
    const other = openWriter();
    other.append(task(other, 'left-unsigned'));
    const lock = tailLockPath({ root }, w.tail);
    plantAt(lock, process.pid, Date.now());

    // The tail moved since this writer's last hold, so what is on it may owe a signature.
    expect(() => w.checkpoint()).toThrow(TailBusyError);
    rmSync(lock);
    expect(w.checkpoint()).not.toBeNull();
  });

  it('releases the lock when the act inside it throws', () => {
    const w = founded();
    const lock = tailLockPath({ root }, w.tail);
    // An event no reader could accept: the writer refuses it before sealing.
    expect(() => w.append(taskCreated(env(w, 't-x'), { title: '' }))).toThrow();
    expect(existsSync(lock)).toBe(false);
    // And the tail is still writable — a refusal may not behave like a crash.
    w.append(task(w, 'after-a-refusal'));
    expect(entries().length).toBe(2);
  });

  it('holds the lock for exactly one act: it is gone once the act returns', () => {
    const w = founded();
    expect(existsSync(tailLockPath({ root }, w.tail))).toBe(false);
    w.append(task(w, 'a'));
    expect(existsSync(tailLockPath({ root }, w.tail))).toBe(false);
    w.checkpoint();
    expect(existsSync(tailLockPath({ root }, w.tail))).toBe(false);
  });

  it('an exclusive act appends through the public doors, under the one hold it is in', () => {
    const w = founded();
    const lock = tailLockPath({ root }, w.tail);
    const holder: string[] = [];
    const appended = w.exclusively(() => {
      holder.push(readFileSync(lock, 'utf-8'));
      // Each of these asks for the lock this writer already holds: without the writer's own
      // hold to answer them they would wait out DEFAULT_WAIT_MS on this live pid and refuse.
      const one = w.append(task(w, 'inside-1'));
      const two = w.appendAll([task(w, 'inside-2'), task(w, 'inside-3')]);
      w.checkpoint();
      holder.push(readFileSync(lock, 'utf-8'));
      return [one, ...two].map((e) => e.link.seq);
    });
    // One hold for the whole act — the same record before and after the appends inside it.
    expect(holder[0]).toBe(holder[1]);
    expect(holder[0]).toContain(String(process.pid));
    expect(appended).toEqual([1, 2, 3]);
    expect(existsSync(lock)).toBe(false);
    expect(verify(root, upcasters)).toMatchObject({ ok: true });
  });

  it('runs the act with the lock held, and gives it back', () => {
    const path = join(root, 'locks', 'probe.lock');
    let heldInside = false;
    withTailLock(path, () => {
      heldInside = existsSync(path);
    });
    expect(heldInside).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses inside the budget it was given rather than waiting forever', () => {
    const path = join(root, 'locks', 'probe.lock');
    withTailLock(path, () => {
      // Nested on the SAME path from the same process: the lock does not re-enter,
      // so this is the deadlock shape, and the budget is what makes it a refusal.
      const started = Date.now();
      expect(() => withTailLock(path, () => undefined, { waitMs: 60 })).toThrow(TailBusyError);
      expect(Date.now() - started).toBeGreaterThanOrEqual(50);
      expect(Date.now() - started).toBeLessThan(2_000);
    });
  });

  // THE VACUITY GUARD under the two breaking cases above is the FIRST case in this
  // block, and it is why that one is written with a live, fresh holder rather than
  // with any convenient value: if breaking were unconditional, "refuses a tail a live
  // process is holding" would fail, because the writer would break the lock and
  // append. The three read together say the judgement has both answers.
});

describe('the lock is machinery, not record', () => {
  it('lives outside the tail directory, so nothing that reads the record meets it', () => {
    const w = founded();
    const lock = tailLockPath({ root }, w.tail);
    expect(lock.startsWith(tailDir({ root }, w.tail))).toBe(false);
    expect(lock).toBe(join(root, 'locks', `${w.tail}.lock`));
  });

  it('records the holder so a later waiter can judge it', () => {
    const path = join(root, 'locks', 'probe.lock');
    let written = '';
    withTailLock(path, () => {
      written = readFileSync(path, 'utf-8');
    });
    const [pid, since] = written.trim().split(' ');
    expect(Number.parseInt(pid as string, 10)).toBe(process.pid);
    expect(Number.parseInt(since as string, 10)).toBeGreaterThan(0);
  });
});
