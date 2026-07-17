import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncBuffer, type SyncBufferEntry } from '@/storage/buffer/sync-buffer.js';

function entry(taskKey: string): SyncBufferEntry {
  return {
    v: 1,
    at: new Date().toISOString(),
    kind: 'task_transitioned',
    taskKey,
    mdTarget: 'x.md',
  };
}

/**
 * The buffer's destructive drain/truncate is guarded by a cooperative
 * file lock. With proper-lockfile's default (10s stale, no sync
 * auto-update) a lock held across a slow section could be stolen by a
 * second process, overlapping the very write the lock protects. The
 * hardened options use a tight 2s stale so a live holder is not stolen
 * within the old window (and the retry budget refuses rather than steals).
 */
describe('SyncBuffer lock hardening', () => {
  let dir: string;
  let lockTarget: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-buflock-'));
    lockTarget = path.join(dir, 'buffer.lock');
    writeFileSync(lockTarget, '', 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not steal a lock held by a live holder — truncate refuses instead', () => {
    // Hold the lock exactly as the buffer would, with the same tight stale.
    const release = lockfile.lockSync(lockTarget, {
      stale: 2000,
      realpath: false,
      onCompromised: () => {},
    });

    try {
      const buffer = new SyncBuffer(dir);
      buffer.append(entry('T-1'));
      // The retry loop (10 × 50ms ≈ 0.5s) is far shorter than the 2s stale,
      // so the held lock is NOT stolen: the contended operation throws.
      expect(() => buffer.truncate()).toThrow();
    } finally {
      release();
    }
  });

  it('reclaims a lock aged past the 2s stale that the old 10s default would have left held', () => {
    // The fix is the `stale` value, so the test must exercise an age that
    // falls between the two: a ~3s-old lock is reclaimable under the new
    // 2000ms stale but would still be held under the old 10000ms default.
    // Acquire, then backdate the lock dir's mtime to 3s ago.
    const release = lockfile.lockSync(lockTarget, { stale: 2000, realpath: false });
    const lockDir = `${lockTarget}.lock`;
    const threeSecondsAgo = new Date(Date.now() - 3000);
    utimesSync(lockDir, threeSecondsAgo, threeSecondsAgo);

    try {
      // Under the hardened 2s stale, the buffer judges the lock stale and
      // reclaims it, so drain() SUCCEEDS. Under the old 10s default the
      // lock would still be live and this would throw — that is the
      // behavioural difference the fix introduces.
      const buffer = new SyncBuffer(dir);
      buffer.append(entry('T-1'));
      expect(() => buffer.drain()).not.toThrow();

      // Cross-check the pre-fix behaviour directly: a fresh acquire with
      // the OLD 10s stale against the same 3s-aged lock is refused.
      const stolen = lockfile.lockSync(lockTarget, { stale: 2000, realpath: false });
      utimesSync(lockDir, threeSecondsAgo, threeSecondsAgo);
      expect(() => lockfile.lockSync(lockTarget, { stale: 10_000, realpath: false })).toThrow();
      stolen();
    } finally {
      // The original holder was already reclaimed; releasing it is a no-op
      // guard in case drain() did not run.
      try {
        release();
      } catch {
        /* already reclaimed */
      }
    }
  });

  it('passes a tight explicit stale (2000ms, not the 10s default) and realpath:false', () => {
    // Pin the hardened options: the theft window is the `stale`, and the
    // default 10s is what made a live holder stealable. A spy captures the
    // options the buffer hands to lockSync.
    const spy = vi.spyOn(lockfile, 'lockSync');
    const buffer = new SyncBuffer(dir);
    buffer.append(entry('T-1'));
    buffer.drain(); // acquires the lock

    expect(spy).toHaveBeenCalled();
    const opts = spy.mock.calls[0]?.[1] as { stale?: number; realpath?: boolean } | undefined;
    expect(opts?.stale).toBe(2000);
    expect(opts?.realpath).toBe(false);
    spy.mockRestore();
  });

  it('acquires and releases cleanly when uncontended (drain works)', () => {
    const buffer = new SyncBuffer(dir);
    buffer.append(entry('T-1'));
    buffer.append(entry('T-2'));

    // drain() acquires the lock, reads, truncates, releases.
    const drained = buffer.drain();
    expect(drained.map((e) => e.taskKey)).toEqual(['T-1', 'T-2']);
    expect(buffer.readAll()).toHaveLength(0);

    // And the lock is free again for a subsequent operation.
    buffer.append(entry('T-3'));
    expect(buffer.drain().map((e) => e.taskKey)).toEqual(['T-3']);
  });
});
