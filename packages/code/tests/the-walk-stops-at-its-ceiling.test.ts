/**
 * The ceiling STOPS the walk, and not merely the counting.
 *
 * A file of its own because it counts `readdirSync` calls, which takes mocking
 * `node:fs` for the whole module graph — and the reach's other cases run the real CLI,
 * which needs the real one.
 *
 * IT EXISTS BECAUSE THE FIRST WRITING OF THE CEILING DID NOT STOP ANYTHING. It returned
 * from the loop of the directory it was in, which left every sibling above still opened
 * and read: the counts came back identical, `truncated` came back true, and every case
 * that asserted the two of them stayed GREEN. Measured — that mutation lit nothing. A
 * bound that only bounds the number is not a bound on the work, and the work is the
 * whole reason a ceiling is here: an unbounded recursive `readdir` inside a verb a
 * person is waiting on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => ({ dirs: [] as string[] }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    readdirSync: ((path: string, options: unknown) => {
      opened.dirs.push(String(path));
      return (real.readdirSync as (p: string, o: unknown) => unknown)(path, options);
    }) as typeof real.readdirSync,
  };
});

const { reachOfAddress } = await import('../src/governed-tree.js');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-ceiling-'));
  // Twelve directories, one file each: enough that a walk which does not stop opens
  // many more than one that does.
  for (let i = 0; i < 12; i += 1) {
    mkdirSync(join(root, `d${String(i).padStart(2, '0')}`), { recursive: true });
    writeFileSync(join(root, `d${String(i).padStart(2, '0')}`, 'f.ts'), 'x');
  }
  opened.dirs = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the ceiling bounds the work and not only the number', () => {
  it('opens far fewer directories once it has stopped', () => {
    const whole = reachOfAddress('governs', '.', root);
    const openedWhole = opened.dirs.length;
    expect(whole?.counted).toBe(12);
    expect(whole?.truncated).toBe(false);
    // The root plus twelve children.
    expect(openedWhole).toBe(13);

    opened.dirs = [];
    const cut = reachOfAddress('governs', '.', root, 3);
    expect(cut?.counted).toBe(3);
    expect(cut?.truncated).toBe(true);
    // Stopping means it stopped OPENING: strictly fewer, and bounded by the ceiling
    // rather than by the size of the tree. A walk that only stopped counting would
    // read all thirteen and this number would be unchanged.
    expect(opened.dirs.length).toBeLessThan(openedWhole);
    expect(opened.dirs.length).toBeLessThanOrEqual(5);
  });
});
