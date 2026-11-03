/**
 * The one rule a tail's merge driver and `mnema record pull` ask: of two copies of a tail file, the
 * longer one is the merge when the other is its start, byte for byte, and anything else is a fork,
 * where nothing is joined and our side stays as it was.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../program.js';
import { forkSentence, joinGrownTail, MERGE_DRIVER, mergeTailFiles } from './record-merge-tail.js';

const bytes = (text: string): Buffer => Buffer.from(text, 'utf-8');

describe('joinGrownTail', () => {
  it('keeps the longer side when the other is its start, whichever side it is', () => {
    expect(joinGrownTail(bytes('a\nb\n'), bytes('a\nb\nc\n'))).toEqual({
      kind: 'longer',
      side: 'theirs',
    });
    expect(joinGrownTail(bytes('a\nb\nc\n'), bytes('a\n'))).toEqual({
      kind: 'longer',
      side: 'ours',
    });
    expect(joinGrownTail(bytes(''), bytes('a\n'))).toEqual({ kind: 'longer', side: 'theirs' });
    expect(joinGrownTail(bytes('a\n'), bytes('a\n'))).toEqual({ kind: 'same' });
  });

  it('a divergence is a fork, at the line where the two sides part', () => {
    expect(joinGrownTail(bytes('a\nb\nc\n'), bytes('a\nb\nd\n'))).toEqual({
      kind: 'fork',
      line: 3,
    });
    expect(joinGrownTail(bytes('x\n'), bytes('y\nz\n'))).toEqual({ kind: 'fork', line: 1 });
    // Same length, one byte apart, is a fork too, not "the same".
    expect(joinGrownTail(bytes('a\nb\n'), bytes('a\nc\n'))).toEqual({ kind: 'fork', line: 2 });
  });
});

describe('mergeTailFiles, the driver', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mnema-merge-tail-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sides = (ours: string, theirs: string) => {
    const paths = { ours: join(dir, 'ours'), theirs: join(dir, 'theirs') };
    writeFileSync(paths.ours, ours);
    writeFileSync(paths.theirs, theirs);
    return paths;
  };

  it('keeps the longer side: their bytes into ours when theirs is longer, ours untouched otherwise', () => {
    const grown = sides('a\n', 'a\nb\n');
    expect(mergeTailFiles(grown)).toEqual({ ok: true, kept: 'theirs' });
    expect(readFileSync(grown.ours, 'utf-8')).toBe('a\nb\n');
    const longer = sides('a\nb\n', 'a\n');
    expect(mergeTailFiles(longer)).toEqual({ ok: true, kept: 'ours' });
    expect(readFileSync(longer.ours, 'utf-8')).toBe('a\nb\n');
  });

  it('a divergence is a fork: it fails, names the line, and leaves our side byte for byte', () => {
    const forked = sides('a\nb\n', 'a\nc\nd\n');
    expect(mergeTailFiles(forked)).toEqual({ ok: false, reason: 'FORK', line: 2 });
    expect(readFileSync(forked.ours, 'utf-8')).toBe('a\nb\n');
    expect(forkSentence('.mnema/tails/t/000001.jsonl', 2)).toMatch(
      /^\.mnema\/tails\/t\/000001\.jsonl: the two sides part at line 2, .*a fork/,
    );
  });

  it('is the driver the record names', () => {
    expect(MERGE_DRIVER).toBe('mnema-tail');
  });
});

describe('mnema record merge-tail, as git calls it', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mnema-merge-tail-verb-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** The verb over two files, in process: what it said on each stream, and whether it failed. */
  async function driver(ours: string, theirs: string) {
    const paths = { ancestor: join(dir, 'o'), ours: join(dir, 'a'), theirs: join(dir, 'b') };
    writeFileSync(paths.ancestor, '');
    writeFileSync(paths.ours, ours);
    writeFileSync(paths.theirs, theirs);
    const err: string[] = [];
    let failed = false;
    const io: CliIo = {
      out: () => undefined,
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    };
    const path = '.mnema/tails/t/000001.jsonl';
    await run(['record', 'merge-tail', paths.ancestor, paths.ours, paths.theirs, path], io);
    return { failed, err: err.join('\n'), merged: readFileSync(paths.ours, 'utf-8') };
  }

  it('exits 0 with the longer side in the file git reads, and says nothing', async () => {
    expect(await driver('a\n', 'a\nb\n')).toEqual({ failed: false, err: '', merged: 'a\nb\n' });
  });

  it('exits non-zero on a fork, naming the path git is merging, and leaves ours', async () => {
    const forked = await driver('a\nb\n', 'a\nc\n');
    expect(forked.failed).toBe(true);
    expect(forked.merged).toBe('a\nb\n');
    expect(forked.err).toContain('.mnema/tails/t/000001.jsonl: the two sides part at line 2');
  });
});
