/**
 * What a writer cites: the head of each other tail its own tail has not cited yet — and,
 * read back, nothing when nothing new was read.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskCreated } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { citedHeadsPath } from './cited-heads.js';
import { readTail } from './store.js';

const upcasters = catalogUpcasters();
const dirs: string[] = [];
const fresh = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `mnema-cited-${label}-`));
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

function machine(cite = true) {
  const writer = openChainForWriting(root, {
    keyRoot: fresh('key'),
    maxUnsignedEvents: 10_000,
    citeHeads: cite,
  });
  let n = 0;
  const write = (): CatalogEvent => {
    n += 1;
    const entry = writer.append(
      taskCreated(
        {
          at: '2026-10-07T10:00:00.000Z',
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: `${writer.tail}-${n}`,
        },
        { title: `task ${n}` },
      ),
    );
    return entry.event;
  };
  const head = (): string =>
    readTail({ root }, writer.tail, upcasters).entries.at(-1)?.link.hash as string;
  return { writer, write, head };
}

describe('a writer cites what it read, once', () => {
  it('a record of one tail: nothing to cite, and no note is kept', () => {
    const a = machine();
    expect(a.write().after).toBeUndefined();
    expect(a.write().after).toBeUndefined();
    expect(existsSync(citedHeadsPath({ root }, a.writer.tail))).toBe(false);
  });

  it('cites the head of another tail the first time, and not again until that tail moves', () => {
    const a = machine();
    const b = machine();
    a.write();
    expect(b.write().after).toEqual([a.head()]);
    expect(b.write().after).toBeUndefined();
    a.write();
    expect(b.write().after).toEqual([a.head()]);
  });

  it('cites every tail that moved, in ascending order of hash', () => {
    const a = machine();
    const c = machine();
    const b = machine();
    a.write();
    c.write();
    expect(b.write().after).toEqual([a.head(), c.head()].sort());
  });

  it('a writer that does not cite writes the event it was handed', () => {
    const a = machine();
    const b = machine(false);
    a.write();
    expect(b.write().after).toBeUndefined();
  });

  it('with the note lost, it cites the heads again once — redundant, and harmless', () => {
    const a = machine();
    const b = machine();
    a.write();
    b.write();
    rmSync(citedHeadsPath({ root }, b.writer.tail));
    expect(b.write().after).toEqual([a.head()]);
    expect(b.write().after).toBeUndefined();
  });
});
