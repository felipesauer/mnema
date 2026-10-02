/**
 * A write the record reports as written is on the disk: every append of an entry and of a
 * checkpoint is synced before it returns, and the directory of a file the append created too.
 *
 * What a sync does to the disk cannot be seen from a test — a power cut is not something the
 * suite can stage. What can be seen is whether it is ASKED FOR, of which file, and before the
 * call returns, so that is what these count: the module is wrapped (an ESM namespace cannot be
 * spied on) and every `fsyncSync` is recorded with the path its descriptor was opened on.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { openChainForWriting } from './chain.js';
import { appendDurably } from './durable.js';
import { checkpointsPath, segmentPath } from './layout.js';
import type { ChainWriter } from './writer.js';

/** Every path a sync was asked of, in the order asked; and which path each open fd names. */
const synced = vi.hoisted(() => ({ paths: [] as string[], fds: new Map<number, string>() }));
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>): number => {
      const fd = actual.openSync(...args);
      synced.fds.set(fd, String(args[0]));
      return fd;
    },
    fsyncSync: (fd: number): void => {
      synced.paths.push(synced.fds.get(fd) ?? `<fd ${fd}>`);
      actual.fsyncSync(fd);
    },
  };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-durable-'));
  synced.paths.length = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('appendDurably', () => {
  it('syncs the file and, when it created the file, the directory that names it', () => {
    const file = join(root, 'segment.jsonl');
    appendDurably(file, 'one\n');
    expect(readFileSync(file, 'utf-8')).toBe('one\n');
    expect(synced.paths).toEqual([file, root]);
  });

  it('syncs only the file when the file was already there', () => {
    const file = join(root, 'segment.jsonl');
    appendDurably(file, 'one\n');
    synced.paths.length = 0;
    appendDurably(file, 'two\n');
    expect(readFileSync(file, 'utf-8')).toBe('one\ntwo\n');
    expect(synced.paths).toEqual([file]);
  });
});

describe('a write the writer returns from is on the disk', () => {
  const env = (w: ChainWriter, subject: string) => ({
    at: '2026-10-01T00:00:00.000Z',
    who: w.anchor,
    signerFp: w.signerFingerprint,
    subject,
  });

  it('syncs the segment an append wrote, and checkpoints.jsonl a checkpoint wrote', () => {
    const w = openChainForWriting(root, { keyRoot: root, maxUnsignedEvents: 10_000 });
    w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
    const tail = readdirSync(join(root, 'tails'))[0] as string;
    const segment = segmentPath({ root }, tail, 1);
    expect(synced.paths).toContain(segment);

    synced.paths.length = 0;
    w.appendAll([memoryCaptured(env(w, 'm-1'), { content: 'a batch of one' })]);
    expect(synced.paths).toEqual([segment]);

    synced.paths.length = 0;
    expect(w.checkpoint()).not.toBeNull();
    const checkpoints = checkpointsPath({ root }, tail);
    // Created by this checkpoint, so its directory is synced after it.
    expect(synced.paths).toEqual([checkpoints, dirname(checkpoints)]);

    synced.paths.length = 0;
    w.append(memoryCaptured(env(w, 'm-2'), { content: 'one more' }));
    expect(w.checkpoint()).not.toBeNull();
    expect(synced.paths).toEqual([segment, checkpoints]);
  });

  it('has no append of the writer that goes around the durable one', () => {
    // The structural half: a new append written with `appendFileSync` straight would pass
    // every case above, which only drive the doors that exist today.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'writer.ts'),
      'utf-8',
    );
    expect(source.match(/appendDurably\(/g)?.length ?? 0).toBe(3);
    expect(source).not.toMatch(/appendFileSync|writeSync\(|createWriteStream/);
  });
});
