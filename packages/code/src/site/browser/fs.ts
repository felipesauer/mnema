/**
 * The part of `node:fs` the verifier reads with, over the files a page carries instead of a
 * disk.
 *
 * `mount` is handed the record's files — path to bytes — once, before the verifier runs, and
 * every read after it answers from them. Nothing here writes: a write, a rename or a lock is
 * a refusal, because a page that verified by changing the record would be verifying
 * something else.
 */

import { Buffer } from './buffer.js';

const files = new Map<string, Buffer>();
const directories = new Set<string>(['/']);
const descriptors = new Map<number, Buffer>();
let nextDescriptor = 3;

/** Replaces what the page carries with `contents`: absolute path to bytes. */
export function mount(contents: ReadonlyMap<string, Uint8Array>): void {
  files.clear();
  directories.clear();
  directories.add('/');
  descriptors.clear();
  for (const [path, bytes] of contents) {
    files.set(path, Buffer.from(bytes));
    for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
      directories.add(path.slice(0, cut));
    }
  }
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), {
    code: 'ENOENT',
  });
}

export function existsSync(path: string): boolean {
  return files.has(path) || directories.has(path);
}

interface Entry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export function readdirSync(path: string, options?: { withFileTypes: true }): string[] | Entry[] {
  if (!directories.has(path)) throw missing(path);
  const prefix = path === '/' ? '/' : `${path}/`;
  const children = new Map<string, boolean>();
  for (const file of files.keys()) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const cut = rest.indexOf('/');
    children.set(cut < 0 ? rest : rest.slice(0, cut), cut >= 0);
  }
  const names = [...children.keys()].sort();
  if (options?.withFileTypes !== true) return names;
  return names.map((name) => ({
    name,
    isDirectory: () => children.get(name) === true,
    isFile: () => children.get(name) === false,
  }));
}

export function readFileSync(path: string): Buffer;
export function readFileSync(path: string, encoding: 'utf-8' | 'utf8'): string;
export function readFileSync(path: string, encoding?: 'utf-8' | 'utf8'): Buffer | string {
  const bytes = files.get(path);
  if (bytes === undefined) throw missing(path);
  return encoding === undefined ? Buffer.from(bytes) : bytes.toString('utf-8');
}

export function statSync(path: string): { size: number; isDirectory(): boolean } {
  const bytes = files.get(path);
  if (bytes !== undefined) return { size: bytes.length, isDirectory: () => false };
  if (directories.has(path)) return { size: 0, isDirectory: () => true };
  throw missing(path);
}

export function openSync(path: string): number {
  const bytes = files.get(path);
  if (bytes === undefined) throw missing(path);
  const descriptor = nextDescriptor++;
  descriptors.set(descriptor, bytes);
  return descriptor;
}

export function fstatSync(descriptor: number): { size: number } {
  return { size: (descriptors.get(descriptor) as Buffer).length };
}

export function readSync(
  descriptor: number,
  into: Uint8Array,
  offset: number,
  length: number,
  position: number,
): number {
  const bytes = descriptors.get(descriptor) as Buffer;
  const chunk = bytes.subarray(position, position + length);
  into.set(chunk, offset);
  return chunk.length;
}

export function closeSync(descriptor: number): void {
  descriptors.delete(descriptor);
}

const READ_ONLY = (name: string) => (): never => {
  throw new Error(`${name} is not available in the browser verifier — it only reads.`);
};

export const mkdirSync = READ_ONLY('mkdirSync');
export const writeFileSync = READ_ONLY('writeFileSync');
export const appendFileSync = READ_ONLY('appendFileSync');
export const renameSync = READ_ONLY('renameSync');
export const truncateSync = READ_ONLY('truncateSync');
export const fsyncSync = READ_ONLY('fsyncSync');
export const writeSync = READ_ONLY('writeSync');
export const readlinkSync = READ_ONLY('readlinkSync');
export const rmSync = READ_ONLY('rmSync');
export const unlinkSync = READ_ONLY('unlinkSync');
