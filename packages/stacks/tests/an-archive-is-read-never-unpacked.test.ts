import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readStackArchive } from '../src/archive.js';
import { validateStack, validateStackFiles } from '../src/validate.js';
import { HELLO_STACK } from './support.js';

/** One tar entry, as a test spells it: a name in bytes, a type flag, and the bytes it holds. */
interface Entry {
  readonly name: string | Buffer;
  readonly type?: string;
  readonly body?: string;
  readonly link?: string;
}

/** A ustar archive of the entries given, so a case can write the entry no tool would. */
function tar(entries: readonly Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const header = Buffer.alloc(512);
    const name = typeof entry.name === 'string' ? Buffer.from(entry.name) : entry.name;
    name.copy(header, 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write(entry.type ?? '0', 156);
    if (entry.link) header.write(entry.link, 157);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.fill(' ', 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** hello-stack's files, as tar entries under the given prefix. */
const hello = (prefix: string): Entry[] =>
  ['stack.json', 'LICENSE', 'skills/hello/SKILL.md', 'agents/greeter.md'].map((path) => ({
    name: `${prefix}${path}`,
    body: readFileSync(join(HELLO_STACK, path), 'utf8'),
  }));

describe('an archive is read in memory, and never unpacked onto the disk', () => {
  it('reads hello-stack from a gzipped tarball to the same digest as the directory', () => {
    const read = readStackArchive(gzipSync(tar(hello(''))));
    expect(read.problems).toEqual([]);
    expect(validateStackFiles(read.files, read.problems).digest).toBe(
      validateStack(HELLO_STACK).digest,
    );
  });

  it('takes off the one directory a code host wraps an archive in', () => {
    const read = readStackArchive(
      tar([{ name: 'hello-stack-1.0.0/', type: '5' }, ...hello('hello-stack-1.0.0/')]),
    );
    expect(read.files.map((f) => f.path).sort()).toEqual([
      'LICENSE',
      'agents/greeter.md',
      'skills/hello/SKILL.md',
      'stack.json',
    ]);
  });

  it.each([
    ['a path that climbs out', { name: '../escape.md', body: 'x' }, 'path-refused'],
    ['an absolute path', { name: '/etc/escape.md', body: 'x' }, 'path-refused'],
    ['a symbolic link', { name: 'skills/hello/link', type: '2', link: '/etc/passwd' }, 'symlink'],
    ['a hard link', { name: 'skills/hello/hard', type: '1', link: 'stack.json' }, 'not-a-file'],
    ['a device', { name: 'skills/hello/dev', type: '3' }, 'not-a-file'],
    [
      'a name that is not UTF-8',
      { name: Buffer.from([0x73, 0x6b, 0xff, 0x2e, 0x6d, 0x64]), body: 'x' },
      'path-refused',
    ],
  ] as const)('refuses %s, and the stack with it', (_, entry, code) => {
    const read = readStackArchive(tar([...hello(''), entry]));
    expect(read.problems.map((p) => p.code)).toEqual([code]);
    expect(validateStackFiles(read.files, read.problems).ok).toBe(false);
  });

  it('refuses bytes that are not an archive at all', () => {
    const read = readStackArchive(Buffer.from('not a tarball, only some text'));
    expect(read.files).toEqual([]);
    expect(read.problems.map((p) => p.code)).toEqual(['not-an-archive']);
  });
});
