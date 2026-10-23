/**
 * The few facts of a tree that a session asks of EVERY project it holds, kept on this machine, so
 * that asking does not open the tree.
 *
 * Two questions are put to all the projects of a workspace and not only to the one the session is
 * in: where did this actor leave off (a run is the actor's wherever it was opened), and is the
 * count of tool calls switched off (any tree can say so). Both are answered from small lists, the
 * tree's runs and the tree's channel switches, but to get the lists the reader used to open each
 * project's projection (create the tables, replay the chain), and with nine other projects that
 * was most of what a session's first call cost.
 *
 * WHERE THE FILE LIVES. Under the mnema home of this machine (`<home>/cache/<digest of the tree's
 * path>/tree-index.json`, wherever `$MNEMA_HOME` puts the home), NEVER inside a project. The read
 * tools write nothing into a project the session does not serve, and a file a clone carries
 * (a `locks/tree-index.json` committed by somebody) is never looked at, because the only place
 * this reads is the one the machine's own home names.
 *
 * WHAT THE FILE IS. A JSON document with a MARK of the tree as it stood when the lists were read
 * (the stamp of the code that folds them, the chain's extent, the fingerprint of every sealed
 * segment and the hash of the last line of every tail) and the lists as the projection gives
 * them. It is derived and deletable: no reader depends on it existing, and a missing, unreadable,
 * unparseable, differently-marked or ill-shaped file is not an error but a reason to read the
 * tree and write the file again.
 *
 * WHEN IT IS BELIEVED. Only while the mark it carries is the mark the tree has now: the extent
 * moves when any tail appends, rotates, appears or vanishes, a sealed segment rewritten changes
 * its fingerprint, and a checkout that swaps the live segment for another of the SAME size
 * changes the last line, which is the hash of the last event and so of everything before it. The
 * one thing not seen is an edit in place, to the same size, of a line before the last of a
 * live segment that leaves the last line alone, which is `verify`'s. The mark is read BEFORE the
 * tree is, as the registry reads the extent before a replay, so an append that lands during the
 * read leaves a mark that is behind the tree and is read again next time.
 *
 * WHERE IT IS NOT USED. A tree with no tail has nothing to index, and a tree whose extent could
 * not be read has no mark worth keeping: both are read, every time, as they were.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type ChainLayout, chainExtent, listTails, orderedSegments } from '@mnema/chain';
import { fingerprintOf, productStamp } from './cache-meta.js';
import type { ChannelSwitchProjection } from './channel.js';
import type { RunProjection } from './run.js';

/** What a session asks of every project: the lists the projection gives, whole. */
export interface TreeFacts {
  readonly runs: readonly RunProjection[];
  readonly channelSwitches: readonly ChannelSwitchProjection[];
}

/** A tree's facts and the mark of the tree they were read at. */
interface Marked {
  readonly mark: string;
  readonly facts: TreeFacts;
}

/**
 * The file a tree's facts are kept in: under the data directory of this machine (the directory
 * that holds `global/` and `identity/`), in a folder named for the digest of the tree's own path.
 * Nothing about the tree's content names it: the mark inside is what says whether it still fits.
 */
export function treeIndexFile(dataDir: string, chainRoot: string): string {
  const digest = createHash('sha256').update(chainRoot).digest('hex').slice(0, 32);
  return join(dataDir, 'cache', digest, 'tree-index.json');
}

/**
 * The facts of a tree: `remembered` while the tree's extent is the one it was remembered at, else
 * the file at `indexFile` when it still describes the tree, else `read`, which opens the tree,
 * and the file is then written for the next reader. A tree that cannot carry a mark (no tail yet,
 * or an extent that could not be read) is read each time.
 *
 * A caller that keeps the answer in memory passes it back as `remembered`, and is then asked what
 * a warm cache is asked: has the extent moved. The sealed segments are looked at when a file is
 * to be believed or written, not on every call of a connection, exactly as a projection held in
 * memory is not asked about them either.
 */
export function treeFactsFrom(
  layout: ChainLayout,
  indexFile: string,
  read: () => TreeFacts,
  remembered?: Known,
): Known | { readonly extent: undefined; readonly facts: TreeFacts } {
  const extent = chainExtent(layout);
  if (extent === '' || extent.startsWith('!')) return { extent: undefined, facts: read() };
  if (remembered?.extent === extent) return remembered;
  const mark = markOf(layout, extent);
  if (mark === undefined) return { extent: undefined, facts: read() };
  const held = readIndex(indexFile);
  if (held?.mark === mark) return { extent, facts: held.facts };
  const facts = read();
  writeIndex(indexFile, { mark, facts });
  return { extent, facts };
}

/** What a caller that keeps a tree's facts keeps with them. */
export interface Known {
  readonly extent: string;
  readonly facts: TreeFacts;
}

/** How much of the end of a segment is looked at for its last line: an entry's line is far shorter. */
const LAST_LINE_BYTES = 64 * 1024;

/** The digest of the last line of a file (of the end of it when the line is longer than the window). */
function lastLineOf(path: string): string {
  let fd: number | undefined;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, LAST_LINE_BYTES);
    const buffer = Buffer.alloc(length);
    fd = openSync(path, 'r');
    const read = readSync(fd, buffer, 0, length, size - length);
    let end = read;
    while (end > 0 && buffer[end - 1] === 0x0a) end -= 1;
    const start = buffer.subarray(0, end).lastIndexOf(0x0a) + 1;
    return createHash('sha256').update(buffer.subarray(start, end)).digest('hex').slice(0, 32);
  } catch {
    return 'unreadable';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The tree as it stands, or undefined when its segments cannot be listed. */
function markOf(layout: ChainLayout, extent: string): string | undefined {
  const sealed: Record<string, string> = {};
  const last: Record<string, string> = {};
  try {
    for (const tail of listTails(layout)) {
      const segments = orderedSegments(layout, tail);
      for (const segment of segments.slice(0, -1)) sealed[segment] = fingerprintOf(segment);
      const live = segments.at(-1);
      if (live !== undefined) last[live] = lastLineOf(live);
    }
  } catch {
    return undefined;
  }
  return JSON.stringify({ stamp: productStamp(), extent, sealed, last });
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrAbsent = (value: unknown): boolean => value === undefined || isText(value);

/** A row of the runs list as the projection gives it; the index is not believed with one that is not. */
function isRun(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const run = row as Record<string, unknown>;
  return (
    isText(run.id) &&
    isText(run.agent) &&
    isText(run.who) &&
    typeof run.open === 'boolean' &&
    isText(run.startedAt) &&
    isTextOrAbsent(run.goal) &&
    isTextOrAbsent(run.outcome) &&
    isTextOrAbsent(run.endedAt) &&
    isTextOrAbsent(run.lastFactAt) &&
    Array.isArray(run.wrote)
  );
}

/** A row of the channel switches as the projection gives it. */
function isSwitch(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const switched = row as Record<string, unknown>;
  return (
    isText(switched.channel) &&
    typeof switched.on === 'boolean' &&
    isText(switched.who) &&
    isText(switched.switchedAt) &&
    isTextOrAbsent(switched.which) &&
    isTextOrAbsent(switched.reason)
  );
}

function readIndex(indexFile: string): Marked | undefined {
  try {
    const parsed = JSON.parse(readFileSync(indexFile, 'utf8')) as Partial<Marked> | null;
    const facts = parsed?.facts;
    if (
      typeof parsed?.mark !== 'string' ||
      facts === undefined ||
      facts === null ||
      !Array.isArray(facts.runs) ||
      !Array.isArray(facts.channelSwitches) ||
      !facts.runs.every(isRun) ||
      !facts.channelSwitches.every(isSwitch)
    )
      return undefined;
    return { mark: parsed.mark, facts };
  } catch {
    return undefined;
  }
}

/**
 * Written to a name of its own and renamed over the file, so a reader never sees half of one. A
 * home that cannot be written to simply has no index.
 */
function writeIndex(indexFile: string, index: Marked): void {
  const temporary = `${indexFile}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(indexFile), { recursive: true });
    writeFileSync(temporary, JSON.stringify(index));
    renameSync(temporary, indexFile);
  } catch {
    // No index: the next reader reads the tree, which is what it did before there was one.
  }
}
