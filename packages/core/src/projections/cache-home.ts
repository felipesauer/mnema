/**
 * Where the cache of reads lives when somebody chose the place: `$MNEMA_CACHE_DIR`.
 *
 * By default a tree keeps the projection it was read into beside itself (`locks/projection.db`).
 * That is the wrong place for three people: whoever reads a checkout they cannot write to, a CI
 * job that wants the cache to outlive the run (a directory the runner's own cache step saves and
 * restores), and several worktrees of one project that would rather build it once. They name a
 * directory instead, and every read — the command line, the server a host spawns, the library —
 * keeps its cache there.
 *
 * IT IS READ IN ONE PLACE. The surface reads the environment once (`discoveryEnv`) and hands the
 * raw value to {@link keepReadCacheIn}, which is the only function that decides what it means; the
 * cache asks {@link readCacheFileFor} where to open. So a door that builds its environment the way
 * the others do cannot disagree with them about this variable.
 *
 * IT IS STILL A CACHE, never the record, and the file's NAME is what keeps it from being read for
 * the wrong project: a directory may hold the caches of any number of projects, and each file is
 * named for the tree it was built from — the tails it holds and the first line of each — so a
 * tree reads only a file that was made from it. What the name cannot vouch for (the file's own
 * contents) is vouched for as it always was: a file the code that wrote it does not stand behind,
 * or that no longer follows the chain, is replayed (`cache-meta.ts`), and one that cannot be had is
 * made again.
 *
 * A DIRECTORY THAT CANNOT SERVE IS REFUSED, not skipped. A person who named a place and was
 * silently given another would find out when the CI cache never hits.
 */

import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, openSync, readSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { type ChainLayout, listTails, orderedSegments, projectionCachePath } from '@mnema/chain';

/** The variable a person sets; named here so a message can name it. */
export const CACHE_DIR_VARIABLE = 'MNEMA_CACHE_DIR';

/** The directory the process keeps its read caches in, or undefined for the trees' own. */
let chosen: string | undefined;

/** How much of a tail's first line is read to name the cache: an entry's line is far shorter. */
const FIRST_LINE_BYTES = 64 * 1024;

/**
 * Takes `$MNEMA_CACHE_DIR` as the environment gave it. Unset or empty is "not chosen"; anything
 * else must be an absolute path to a directory that exists and can be written, or this throws
 * with what to do — and leaves the previous choice as it was.
 */
export function keepReadCacheIn(raw: string | undefined): void {
  if (raw === undefined || raw === '') {
    chosen = undefined;
    return;
  }
  const way = `Create it and make it writable, or unset ${CACHE_DIR_VARIABLE} to keep the cache in the project's tree.`;
  if (!isAbsolute(raw)) {
    throw new Error(
      `${CACHE_DIR_VARIABLE} is ${JSON.stringify(raw)}, a relative path, which would move with the ` +
        `working directory. Set it to an absolute directory, or unset it to keep the cache in the project's tree.`,
    );
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(raw).isDirectory();
  } catch {
    // Not there: said below with the rest.
  }
  if (!isDirectory) {
    throw new Error(
      `${CACHE_DIR_VARIABLE} is ${JSON.stringify(raw)}, which is not a directory that exists. ${way}`,
    );
  }
  try {
    accessSync(raw, constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      `${CACHE_DIR_VARIABLE} is ${JSON.stringify(raw)}, a directory this process cannot write to. ${way}`,
    );
  }
  chosen = raw;
}

/** Whether a directory was chosen for the read caches. */
export function readCacheIsChosen(): boolean {
  return chosen !== undefined;
}

/**
 * What names a tree among the trees of any number of projects: each tail's name and the digest of
 * its first line. A tail's first entry carries what it was founded with — time, author, content —
 * so two projects do not share it even when one installation wrote the first tail of both.
 */
function identityOf(layout: ChainLayout): string {
  const hash = createHash('sha256');
  for (const tail of listTails(layout)) {
    const [first] = orderedSegments(layout, tail);
    hash.update(tail);
    hash.update('\0');
    if (first !== undefined) hash.update(firstLineOf(first));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 32);
}

/** The first line of a file, as bytes (the whole of what was read when it has no newline). */
function firstLineOf(path: string): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(FIRST_LINE_BYTES);
    const read = readSync(fd, buffer, 0, FIRST_LINE_BYTES, 0);
    const end = buffer.subarray(0, read).indexOf(0x0a);
    return buffer.subarray(0, end === -1 ? read : end);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The file this tree's cache is kept in when a directory was chosen — `undefined` when none was,
 * which is "the tree's own place" ({@link keptCachePath}).
 */
export function readCacheFileFor(layout: ChainLayout): string | undefined {
  if (chosen === undefined) return undefined;
  return join(chosen, `projection-${identityOf(layout)}.db`);
}

/** Where this tree's cache is kept, whichever place that is. */
export function keptCachePath(layout: ChainLayout): string {
  return readCacheFileFor(layout) ?? projectionCachePath(layout);
}
