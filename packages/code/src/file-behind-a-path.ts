/**
 * What is at a path today: whether a file is there and the SHA-256 of its bytes.
 *
 * A link may end in a path, and the record keeps the path, not the file. `refs` and
 * `audit_refs` ask this for the id they were handed when no tree authored it, so a reader
 * following an edge to `src/a.ts` learns in the same answer whether that file still exists and
 * which bytes it holds now. It reads the working tree and writes nothing.
 *
 * The path is read against the project's ROOT (the same root an address is recorded relative to),
 * through the reduction the gates compare by, and a path that lies outside the project is not
 * read at all: it answers nothing rather than hashing a file the record has no business naming.
 * That holds for the path as the file system resolves it, not only as it is spelled: a directory
 * that is a link out of the project, anywhere along the path, puts the file outside, and the
 * answer is nothing. A link that stays inside the project is followed through. A link as the LAST
 * part of the path is not followed (the walk that counts files does not follow one either), so it
 * is reported as what it is and not as the file behind it.
 */

import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { ReferenceGraph } from '@mnema/context';
import { addressLiesOutside, addressRelativeToRoot } from './governed-tree.js';

/** What is at a path under the project's root. */
export type FileBehindAPath =
  | { readonly path: string; readonly exists: false }
  | {
      readonly path: string;
      readonly exists: true;
      readonly kind: 'file';
      /** The size of the file, in bytes. */
      readonly bytes: number;
      /** The lowercase hex SHA-256 of its bytes now. */
      readonly sha256: string;
    }
  | {
      readonly path: string;
      readonly exists: true;
      /** A directory is named and not hashed; anything else (a link, a device) is `other`. */
      readonly kind: 'directory' | 'other';
    };

/** The shape of an entity id: such a word names a record, never a file. */
const AN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * What is at the id a graph was walked from, when no tree authored it: the one case a reference
 * graph's origin can be a path. An id some tree holds is a record, never a file, so it is not asked.
 */
export function fileOfTheOrigin(root: string, graph: ReferenceGraph): FileBehindAPath | undefined {
  if (graph.nodes.some((node) => node.id === graph.id && node.resolved)) return undefined;
  return fileBehindAPath(root, graph.id);
}

/**
 * What is at `text`, read as a path under `root`, or `undefined` when it is not one to read: an
 * id, or a path outside the project.
 */
export function fileBehindAPath(root: string, text: string): FileBehindAPath | undefined {
  if (AN_ID.test(text.trim()) || addressLiesOutside(text, root)) return undefined;
  const path = addressRelativeToRoot(text, root);
  const at = join(root, path);
  if (resolvesOutside(root, at)) return undefined;
  let found: ReturnType<typeof lstatSync>;
  try {
    found = lstatSync(at);
  } catch {
    return { path, exists: false };
  }
  if (found.isDirectory()) return { path, exists: true, kind: 'directory' };
  if (!found.isFile()) return { path, exists: true, kind: 'other' };
  try {
    return { path, exists: true, kind: 'file', bytes: found.size, sha256: sha256OfFile(at) };
  } catch {
    // Present and not readable (permissions, a race with a delete): it is there, and what it holds
    // is not something this can say, so it is reported as the one thing that is known.
    return { path, exists: true, kind: 'other' };
  }
}

/**
 * Whether the directory `at` sits in, with every link along the way resolved, is outside the
 * project's root. A directory that does not exist is not outside: the file is simply absent.
 */
function resolvesOutside(root: string, at: string): boolean {
  let realRoot: string;
  let realParent: string;
  try {
    realRoot = realpathSync(root);
    realParent = realpathSync(dirname(at));
  } catch {
    return false;
  }
  const from = relative(realRoot, realParent);
  return from === '..' || from.startsWith(`..${sep}`) || isAbsolute(from);
}

/** The digest of one file, read in chunks so a large file is never held whole. */
function sha256OfFile(path: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(path, 'r');
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}
