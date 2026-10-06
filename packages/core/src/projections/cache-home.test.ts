/**
 * `$MNEMA_CACHE_DIR` — the cache of reads kept in a directory somebody chose — and what keeps it a
 * cache: never the record, and never another project's.
 *
 * What each case holds, read off the files that land rather than off the functions that make them:
 *
 *   - the cache is IN THE CHOSEN DIRECTORY and the tree gets no `locks/projection.db` of its own,
 *     which is what a checkout nobody can write to needs;
 *   - ONE DIRECTORY, TWO PROJECTS: each is given a file of its own and each answers its own record,
 *     and a file built from one is never what the other opens;
 *   - A FILE THAT DOES NOT SERVE IS MADE AGAIN, and deleting it changes no answer;
 *   - A DIRECTORY THAT CANNOT SERVE IS REFUSED, with what to do, and the choice before it stands.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting, projectionCachePath } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, type WriteContext } from '../workflow/operations.js';
import { ProjectionCache } from './cache.js';
import { keepReadCacheIn } from './cache-home.js';

const upcasters = catalogUpcasters();

let sandbox: string;
let cacheDir: string;
let keys: string;
const open: ProjectionCache[] = [];

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cache-home-'));
  cacheDir = join(sandbox, 'shared-cache');
  keys = join(sandbox, 'keys');
  mkdirSync(cacheDir);
});

afterEach(() => {
  keepReadCacheIn(undefined);
  closeAll();
  chmodSync(cacheDir, 0o700);
  rmSync(sandbox, { recursive: true, force: true });
});

function closeAll(): void {
  for (const cache of open.splice(0)) cache.close();
}

/** A project's tree with one task whose title says whose it is. */
function aProject(name: string): string {
  const root = join(sandbox, name, 'tree');
  mkdirSync(root, { recursive: true });
  const ctx: WriteContext = {
    writer: openChainForWriting(root, { keyRoot: keys }),
    layout: { root },
    upcasters,
  };
  const made = createTask(ctx, { title: `the task of ${name}` });
  if (!made.ok) throw new Error(`setup refused: ${JSON.stringify(made)}`);
  return root;
}

/** What a reader of this tree is answered, through the cache the process keeps. */
function read(root: string): string[] {
  const cache = ProjectionCache.open(root, { upcasters, persist: true });
  open.push(cache);
  cache.refresh();
  return cache.listTasks().map((task) => task.title);
}

/** What a file in the chosen directory holds, read as it lies, without bringing it forward. */
function heldBy(root: string, file: string): string[] {
  const cache = ProjectionCache.open(root, { upcasters, dbPath: join(cacheDir, file) });
  open.push(cache);
  return cache.listTasks().map((task) => task.title);
}

const filesIn = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.db'));

describe('MNEMA_CACHE_DIR — the cache of reads in a chosen directory', () => {
  it('keeps it there, and leaves the tree without one', () => {
    const root = aProject('alpha');
    keepReadCacheIn(cacheDir);
    expect(read(root)).toEqual(['the task of alpha']);
    expect(filesIn(cacheDir)).toHaveLength(1);
    expect(existsSync(projectionCachePath({ root }))).toBe(false);
  });

  it('is not used when the variable is unset or empty', () => {
    const root = aProject('alpha');
    keepReadCacheIn('');
    read(root);
    expect(filesIn(cacheDir)).toEqual([]);
    expect(existsSync(projectionCachePath({ root }))).toBe(true);
  });

  it('gives two projects that share a directory a file each, and each reads only its own', () => {
    const alpha = aProject('alpha');
    const beta = aProject('beta');
    keepReadCacheIn(cacheDir);
    expect(read(alpha)).toEqual(['the task of alpha']);
    expect(read(beta)).toEqual(['the task of beta']);
    const files = filesIn(cacheDir);
    expect(files).toHaveLength(2);
    // Each file still holds the record it was built from after the other project read: beta never
    // opened alpha's file, let alone wrote over it.
    expect(files.map((file) => heldBy(alpha, file)).sort()).toEqual([
      ['the task of alpha'],
      ['the task of beta'],
    ]);
    // And reading again keeps the two apart.
    expect(read(alpha)).toEqual(['the task of alpha']);
    expect(filesIn(cacheDir)).toHaveLength(2);
  });

  it('is shared by two readers of one project', () => {
    const root = aProject('alpha');
    keepReadCacheIn(cacheDir);
    read(root);
    read(root);
    expect(filesIn(cacheDir)).toHaveLength(1);
  });

  it('makes the file again when it does not serve, and deleting it changes no answer', () => {
    const root = aProject('alpha');
    keepReadCacheIn(cacheDir);
    read(root);
    const [name] = filesIn(cacheDir) as [string];
    closeAll();
    writeFileSync(join(cacheDir, name), 'not a database at all');
    expect(read(root)).toEqual(['the task of alpha']);
    closeAll();
    rmSync(join(cacheDir, name), { force: true });
    expect(read(root)).toEqual(['the task of alpha']);
  });
});

describe('MNEMA_CACHE_DIR — a directory that cannot serve is refused, with what to do', () => {
  it('refuses a relative path', () => {
    expect(() => keepReadCacheIn('cache')).toThrow(/relative.*absolute directory.*unset it/s);
  });

  it('refuses a directory that does not exist', () => {
    expect(() => keepReadCacheIn(join(sandbox, 'nowhere'))).toThrow(
      /not a directory that exists\. Create it and make it writable, or unset MNEMA_CACHE_DIR/,
    );
  });

  it('refuses a file', () => {
    const file = join(sandbox, 'a-file');
    writeFileSync(file, '');
    expect(() => keepReadCacheIn(file)).toThrow(/not a directory that exists/);
  });

  it.skipIf(process.getuid?.() === 0)('refuses a directory it cannot write to', () => {
    chmodSync(cacheDir, 0o500);
    expect(() => keepReadCacheIn(cacheDir)).toThrow(/cannot write to/);
  });

  it('leaves the earlier choice standing when it refuses', () => {
    const root = aProject('alpha');
    keepReadCacheIn(cacheDir);
    expect(() => keepReadCacheIn('relative')).toThrow();
    read(root);
    expect(filesIn(cacheDir)).toHaveLength(1);
  });
});
