import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendCappedJsonl } from '@/utils/capped-jsonl.js';

/** Reads the file back as an array of non-empty lines. */
function lines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

describe('appendCappedJsonl', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-capped-'));
    file = path.join(dir, 'log.jsonl');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends below the cap (creating the file and parent dir)', () => {
    const nested = path.join(dir, 'a', 'b', 'log.jsonl');
    appendCappedJsonl(nested, 'one', 5);
    appendCappedJsonl(nested, 'two', 5);
    expect(lines(nested)).toEqual(['one', 'two']);
  });

  it('drops the oldest once the cap is reached, keeping the newest', () => {
    for (let i = 0; i < 7; i += 1) appendCappedJsonl(file, `e${i}`, 3);
    // cap 3 → the last three appended survive, in order.
    expect(lines(file)).toEqual(['e4', 'e5', 'e6']);
  });

  it('settles at exactly the cap when appending across the boundary', () => {
    for (let i = 0; i < 3; i += 1) appendCappedJsonl(file, `e${i}`, 3);
    expect(lines(file)).toHaveLength(3); // at cap, no drop yet
    appendCappedJsonl(file, 'e3', 3);
    expect(lines(file)).toEqual(['e1', 'e2', 'e3']); // one over → drop-oldest, still 3
  });

  it('ends every line with a newline (valid JSONL)', () => {
    appendCappedJsonl(file, 'x', 2);
    appendCappedJsonl(file, 'y', 2);
    appendCappedJsonl(file, 'z', 2); // triggers the rewrite path
    expect(readFileSync(file, 'utf-8').endsWith('\n')).toBe(true);
  });
});
