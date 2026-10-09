import { gunzipSync } from 'node:zlib';
import { refusePath, type StackFile } from './digest.js';
import type { StackFiles } from './files.js';
import type { Problem } from './problem.js';

/**
 * The most an archive may hold once unzipped. A stack is a handful of text files; a bound is what
 * keeps a small gzip from becoming a large allocation before a single name has been read.
 */
const MOST_BYTES = 64 * 1024 * 1024;

const BLOCK = 512;

/** A field of a ustar header, up to its first NUL. */
const field = (header: Buffer, at: number, length: number): Buffer => {
  const raw = header.subarray(at, at + length);
  const end = raw.indexOf(0);
  return end === -1 ? raw : raw.subarray(0, end);
};

const octal = (header: Buffer, at: number, length: number): number =>
  Number.parseInt(field(header, at, length).toString('latin1').trim() || '0', 8);

/** The `path=` record of a pax extended header, as bytes, if it has one. */
function paxPath(body: Buffer): Buffer | undefined {
  let at = 0;
  let path: Buffer | undefined;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(body.subarray(at, space).toString('latin1'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = body.subarray(space + 1, at + length - 1);
    if (record.subarray(0, 5).toString('latin1') === 'path=') path = record.subarray(5);
    at += length;
  }
  return path;
}

/**
 * The files of a stack that arrives as a tar archive, gzipped or not, read in memory: nothing is
 * written to the disk, so an entry that names a place outside the stack names nothing at all.
 *
 * It holds an archive to what {@link readStackFiles} holds a directory to. A regular file is a
 * file; a directory entry is skipped; a symbolic link, a hard link, a device or anything else is
 * a problem; a name that is not UTF-8 or that the digest would refuse (`..`, absolute, a control
 * character) is a problem. `.git/` is left out. When every file sits under one directory and
 * there is no `stack.json` at the top — the shape a code host gives an archive of a repository —
 * that directory is taken off.
 */
export function readStackArchive(bytes: Uint8Array): StackFiles {
  const problems: Problem[] = [];
  let data = Buffer.from(bytes);
  if (data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = gunzipSync(data, { maxOutputLength: MOST_BYTES });
    } catch {
      return { files: [], problems: [notAnArchive('it is gzipped and does not unzip')] };
    }
  }
  if (data.length < BLOCK || data.subarray(257, 262).toString('latin1') !== 'ustar') {
    return { files: [], problems: [notAnArchive('it is not a tar archive')] };
  }
  const read: { raw: Buffer; bytes: Buffer }[] = [];
  let at = 0;
  let longName: Buffer | undefined;
  while (at + BLOCK <= data.length) {
    const header = data.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = data.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x' || type === 'L') {
      longName = type === 'x' ? paxPath(body) : field(body, 0, body.length);
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(header, 345, 155);
    const raw =
      longName ??
      (prefix.length > 0
        ? Buffer.concat([prefix, Buffer.from('/'), field(header, 0, 100)])
        : field(header, 0, 100));
    longName = undefined;
    const shown = raw.toString('latin1');
    const name = raw.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(raw)) {
      problems.push({
        code: 'path-refused',
        path: shown,
        message: `${JSON.stringify(shown)} is not a name in UTF-8; the digest names paths as UTF-8 bytes`,
      });
      continue;
    }
    const path = name.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (type === '5' || path === '') continue;
    if (path === '.git' || path.startsWith('.git/')) continue;
    const refusal = refusePath(path);
    if (refusal) {
      problems.push({ code: 'path-refused', path, message: `${path}: ${refusal.message}` });
    } else if (type === '2') {
      problems.push({
        code: 'symlink',
        path,
        message: `${path} is a symbolic link; a stack holds files, and a link names a place, not bytes`,
      });
    } else if (type === '0' || type === '\0') {
      read.push({ raw, bytes: Buffer.from(body) });
    } else {
      problems.push({
        code: 'not-a-file',
        path,
        message: `${path} is neither a file nor a directory`,
      });
    }
  }
  const paths = read.map((r) => r.raw.toString('utf8').replace(/^(\.\/)+/, ''));
  const top = paths[0]?.split('/')[0];
  const wrapped =
    top !== undefined &&
    !paths.includes('stack.json') &&
    paths.every((p) => p.startsWith(`${top}/`));
  const files: StackFile[] = read
    .map((r, i) => ({
      path: wrapped ? (paths[i] as string).slice((top as string).length + 1) : (paths[i] as string),
      bytes: r.bytes,
    }))
    .filter((f) => f.path !== '.git' && !f.path.startsWith('.git/'));
  return { files, problems };
}

function notAnArchive(why: string): Problem {
  return { code: 'not-an-archive', message: `the file is not a stack archive: ${why}` };
}
