/**
 * The files a page carries, read through the names `node:fs` and `node:path` are imported by.
 *
 * What the chain asks of the disk is small and exact — which tails exist, a file whole, a file
 * backwards in chunks — so this pins exactly those, and that nothing that would write is
 * available.
 */

import { describe, expect, it } from 'vitest';
import { Buffer } from './buffer.js';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mount,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from './fs.js';
import { basename, dirname, join } from './path.js';

function mounted(files: Record<string, string>): void {
  mount(new Map(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)])));
}

describe('the files a page carries', () => {
  it('answers existence, listing and kind the way the chain asks them', () => {
    mounted({
      '/r/tails/a-1/000001.jsonl': 'x\n',
      '/r/tails/b-2/000001.jsonl': 'y\n',
      '/r/keys/k.pub': 'K',
    });
    expect(existsSync('/r/tails')).toBe(true);
    expect(existsSync('/r/tails/a-1/000002.jsonl')).toBe(false);
    expect(readdirSync('/r/keys')).toEqual(['k.pub']);
    const kinds = (
      readdirSync('/r', { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]
    ).map((entry) => [entry.name, entry.isDirectory()]);
    expect(kinds).toEqual([
      ['keys', true],
      ['tails', true],
    ]);
    expect(readdirSync('/r/tails')).toEqual(['a-1', 'b-2']);
    expect(() => readdirSync('/r/nowhere')).toThrow(/ENOENT/);
  });

  it('reads a file whole, as text or as bytes, and says how big it is', () => {
    mounted({ '/r/f': 'héllo' });
    expect(readFileSync('/r/f', 'utf-8')).toBe('héllo');
    expect(readFileSync('/r/f').length).toBe(6);
    expect(statSync('/r/f').size).toBe(6);
    expect(statSync('/r').isDirectory()).toBe(true);
    expect(() => readFileSync('/r/missing')).toThrow(/ENOENT/);
  });

  it('reads a file by descriptor, in chunks from a position', () => {
    mounted({ '/r/f': 'abcdefgh' });
    const fd = openSync('/r/f');
    expect(fstatSync(fd).size).toBe(8);
    const into = Buffer.alloc(3);
    expect(readSync(fd, into, 0, 3, 5)).toBe(3);
    expect(into.toString()).toBe('fgh');
    expect(readSync(fd, into, 0, 3, 8)).toBe(0);
    closeSync(fd);
  });

  it('forgets what it carried when it is handed another record, and writes nothing', () => {
    mounted({ '/r/old': '1' });
    mounted({ '/r/new': '2' });
    expect(existsSync('/r/old')).toBe(false);
    expect(() => mkdirSync()).toThrow(/only reads/);
  });
});

describe('the paths the chain composes', () => {
  it('joins, splits and names as POSIX paths', () => {
    expect(join('/r', 'tails', 'a-1')).toBe('/r/tails/a-1');
    expect(join('/r/', '/keys', '../tails', './x')).toBe('/r/tails/x');
    expect(dirname('/r/tails/a')).toBe('/r/tails');
    expect(dirname('/a')).toBe('/');
    expect(basename('/r/keys/k.pub')).toBe('k.pub');
  });
});
