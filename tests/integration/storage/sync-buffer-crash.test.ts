import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncBuffer, type SyncBufferEntry } from '@/storage/buffer/sync-buffer.js';

/**
 * End-to-end recovery scenarios for the sync buffer.
 *
 * These exercise the "process dies mid-flush" path that the unit
 * tests can't reach without a real second process — the in-memory
 * buffer state would simply not persist across the simulated crash.
 */
describe('SyncBuffer crash recovery (E2E)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-buffer-crash-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recovers cleanly when a child process is killed before drain completes', async () => {
    // Pre-seed the buffer with a few entries from this process.
    const buffer = new SyncBuffer(dir);
    for (let i = 1; i <= 5; i += 1) {
      buffer.append({
        v: 1,
        at: new Date().toISOString(),
        kind: 'task_synced',
        taskKey: `TST-${i}`,
        mdTarget: `backlog/DRAFT/TST-${i}.md`,
      });
    }

    // Spawn a child that opens the buffer and then blocks forever; we
    // SIGKILL it from the parent before drain runs. This is the
    // "process dies mid-flush" path; the buffer file must survive.
    const childScript = path.join(dir, 'child.mjs');
    writeFileSync(
      childScript,
      [
        `import { SyncBuffer } from '${pathToFileUrl(syncBufferModulePath())}';`,
        `new SyncBuffer(${JSON.stringify(dir)});`,
        'process.stdout.write("ready\\n");',
        'await new Promise(() => {});',
      ].join('\n'),
      'utf-8',
    );

    const child = spawn(process.execPath, [childScript], { stdio: ['ignore', 'pipe', 'ignore'] });
    await waitForStdout(child, 'ready', 5_000);
    const exitPromise = new Promise<void>((resolve) => child.once('close', () => resolve()));
    child.kill('SIGKILL');
    await exitPromise;

    // Buffer file is still intact: the child died before truncate.
    const survivor = new SyncBuffer(dir);
    const remaining = survivor.readAll();
    expect(remaining).toHaveLength(5);

    // Recovery via drain() in a fresh process should empty the buffer
    // and surface the same entries the killed child never saw.
    const drained = survivor.drain();
    expect(drained.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2', 'TST-3', 'TST-4', 'TST-5']);
    expect(survivor.size()).toBe(0);
  });

  it('skips a corrupted half-line written by an interrupted append', () => {
    const buffer = new SyncBuffer(dir);
    buffer.append({
      v: 1,
      at: '2026-05-07T00:00:00.000Z',
      kind: 'task_synced',
      taskKey: 'GOOD-1',
      mdTarget: 'backlog/DRAFT/GOOD-1.md',
    } satisfies SyncBufferEntry);

    // Simulate a partial write by hand — exactly the kind of garbage
    // a SIGKILL between O_APPEND syscalls could leave behind.
    const bufferPath = buffer.getPath();
    const original = readFileSync(bufferPath, 'utf-8');
    writeFileSync(bufferPath, `${original}{"v":1,"at":"2026-05-07T00:00:00.000Z","ki`, 'utf-8');

    const drained = buffer.drain();
    expect(drained.map((e) => e.taskKey)).toEqual(['GOOD-1']);
    expect(existsSync(bufferPath)).toBe(true);
  });
});

function pathToFileUrl(absolute: string): string {
  return new URL(`file://${absolute}`).toString();
}

function syncBufferModulePath(): string {
  // Resolve to the compiled dist artefact when running the suite
  // from `pnpm test`. The compiled file is the only place ESM imports
  // can reach without going through tsx.
  return path.resolve('dist/storage/buffer/sync-buffer.js');
}

function waitForStdout(
  child: ReturnType<typeof spawn>,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.stdout === null) {
      reject(new Error('child has no stdout stream'));
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for stdout marker "${needle}"`));
    }, timeoutMs);
    let buf = '';
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('utf-8');
      if (buf.includes(needle)) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
  });
}
