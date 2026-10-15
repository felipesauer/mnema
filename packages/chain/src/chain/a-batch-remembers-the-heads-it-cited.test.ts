/**
 * A batch cites like a single append does, and remembers what it cited: the write after it does
 * not name the same head again. `cited-heads.test.ts` asks this of single appends; the batch is
 * the other door onto the tail.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { taskBirth, taskCreated } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { readTail } from './store.js';
import type { ChainWriter } from './writer.js';

const dirs: string[] = [];
const fresh = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `mnema-batch-cites-${label}-`));
  dirs.push(dir);
  return dir;
};
let root: string;
beforeEach(() => {
  root = fresh('record');
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const machine = (): ChainWriter =>
  openChainForWriting(root, { keyRoot: fresh('key'), maxUnsignedEvents: 10_000, citeHeads: true });

const env = (w: ChainWriter, subject: string) => ({
  at: '2026-10-07T10:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

const headOf = (w: ChainWriter): string =>
  readTail({ root }, w.tail, catalogUpcasters()).entries.at(-1)?.link.hash as string;

describe('a batch cites the head of the other tail and remembers it', () => {
  it('names it on the first event of the batch, and the write after it names nothing', () => {
    const a = machine();
    const b = machine();
    a.append(taskCreated(env(a, 'a-1'), { title: 'a' }));

    const batch = b.appendAll(taskBirth(env(b, 'b-1'), { title: 'born', initial: 'draft' }));
    expect(batch[0]?.event.after).toEqual([headOf(a)]);
    expect(batch.slice(1).every((entry) => entry.event.after === undefined)).toBe(true);

    const next = b.append(taskCreated(env(b, 'b-2'), { title: 'after the batch' }));
    expect(next.event.after).toBeUndefined();
  });
});
