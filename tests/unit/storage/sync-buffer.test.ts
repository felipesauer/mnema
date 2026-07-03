import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncBuffer, type SyncBufferEntry } from '@/storage/buffer/sync-buffer.js';

function makeEntry(taskKey: string): SyncBufferEntry {
  return {
    v: 1,
    at: new Date().toISOString(),
    kind: 'task_synced',
    taskKey,
    mdTarget: `backlog/DRAFT/${taskKey}.md`,
  };
}

describe('SyncBuffer', () => {
  let dir: string;
  let buffer: SyncBuffer;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-sync-buffer-'));
    buffer = new SyncBuffer(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the state directory when missing', () => {
    rmSync(dir, { recursive: true, force: true });
    const fresh = new SyncBuffer(dir);
    fresh.append(makeEntry('TST-1'));
    expect(existsSync(fresh.getPath())).toBe(true);
  });

  it('appends entries on separate JSONL lines', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.append(makeEntry('TST-2'));

    const raw = readFileSync(buffer.getPath(), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as SyncBufferEntry);
    expect(parsed.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
  });

  it('reads back every entry in order', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.append(makeEntry('TST-2'));

    const entries = buffer.readAll();
    expect(entries.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
  });

  it('returns empty array on missing or blank file', () => {
    expect(buffer.readAll()).toEqual([]);
    writeFileSync(buffer.getPath(), '\n\n', 'utf-8');
    expect(buffer.readAll()).toEqual([]);
  });

  it('skips malformed lines without crashing', () => {
    writeFileSync(
      buffer.getPath(),
      `${JSON.stringify(makeEntry('TST-1'))}\n{not json\n${JSON.stringify(makeEntry('TST-2'))}\n`,
      'utf-8',
    );

    const entries = buffer.readAll();
    expect(entries.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
  });

  it('truncate() leaves an empty file behind', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.truncate();
    expect(buffer.size()).toBe(0);
    expect(existsSync(buffer.getPath())).toBe(true);
    expect(readFileSync(buffer.getPath(), 'utf-8')).toBe('');
  });

  it('drain() returns the entries and empties the file in one critical section', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.append(makeEntry('TST-2'));

    const drained = buffer.drain();
    expect(drained.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
    expect(buffer.size()).toBe(0);
  });

  it('size() counts lines (incl. a malformed one) without parsing them', () => {
    // A malformed line is dropped by readAll (parse fails) but still
    // occupies the buffer — so size() (line count) counts it while
    // readAll (parsed entries) does not. This proves size() does not go
    // through the JSON.parse path.
    writeFileSync(
      buffer.getPath(),
      `${JSON.stringify(makeEntry('TST-1'))}\n{not json\n${JSON.stringify(makeEntry('TST-2'))}\n`,
      'utf-8',
    );
    expect(buffer.size()).toBe(3); // three non-empty lines
    expect(buffer.readAll()).toHaveLength(2); // only the two parseable ones
  });

  it('size() ignores blank lines and a missing file', () => {
    expect(buffer.size()).toBe(0); // file absent
    writeFileSync(buffer.getPath(), '\n\n', 'utf-8');
    expect(buffer.size()).toBe(0); // only blank lines
    buffer.append(makeEntry('TST-1'));
    expect(buffer.size()).toBe(1);
  });

  it('the lock backoff parks the thread instead of burning CPU', () => {
    // Hold the lock so a second buffer's drain() must go through the
    // retry backoff. A spin loop would consume CPU ≈ wall-clock; the
    // Atomics.wait park consumes far less. Assert CPU time is well under
    // the wall time spent waiting.
    const a = new SyncBuffer(dir);
    a.append(makeEntry('TST-1'));
    // Take and hold the lock out from under the retry loop.
    // biome-ignore lint/suspicious/noExplicitAny: reach the private lock for the test
    const release = (a as any).acquireLock() as () => void;

    const b = new SyncBuffer(dir);
    const cpuBefore = process.cpuUsage();
    const wallBefore = Date.now();
    // b.drain() will retry (≈10×50ms) and then fail to acquire → throws.
    expect(() => b.drain()).toThrow();
    const wallMs = Date.now() - wallBefore;
    const cpuMs = (process.cpuUsage(cpuBefore).user + process.cpuUsage(cpuBefore).system) / 1000;
    release();

    // It genuinely waited (multiple backoffs)…
    expect(wallMs).toBeGreaterThan(100);
    // …but did not spin: CPU time is a fraction of the wall time. A busy
    // loop would make cpuMs ≈ wallMs; parking keeps it far below.
    expect(cpuMs).toBeLessThan(wallMs / 2);
  });

  it('a second drain() while the lock is held by a parallel buffer waits, then sees an empty buffer', () => {
    buffer.append(makeEntry('TST-1'));

    // Two SyncBuffer instances on the same dir simulate two MCP
    // servers sharing the project. Lock retries (50ms..200ms × 10)
    // are plenty for back-to-back calls; what we need to verify is
    // that the second caller sees an *empty* buffer, not the same
    // entry twice.
    const a = new SyncBuffer(dir);
    const b = new SyncBuffer(dir);

    const firstDrain = a.drain();
    const secondDrain = b.drain();

    expect(firstDrain.map((e) => e.taskKey)).toEqual(['TST-1']);
    expect(secondDrain).toEqual([]);
  });
});
