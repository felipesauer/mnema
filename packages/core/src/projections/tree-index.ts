/**
 * The few facts of a tree that a session asks of EVERY project it holds, kept beside the tree, so
 * that asking does not open it.
 *
 * Two questions are put to all the projects of a workspace and not only to the one the session is
 * in: where did this actor leave off (a run is the actor's wherever it was opened), and is the
 * count of tool calls switched off (any tree can say so). Both are answered from small lists, the
 * tree's runs and the tree's channel switches, but to get the lists the reader used to open each
 * project's projection (create the tables, replay the chain), and with nine other projects that
 * was most of what a session's first call cost.
 *
 * WHAT THE FILE IS. A JSON document under the tree's `locks/` with a MARK of the tree as it stood
 * when the lists were read (the stamp of the code that folds them, the chain's extent, and the
 * fingerprint of every sealed segment) and the lists as the projection gives them. It is derived
 * and deletable: no reader depends on it existing, and a missing, unreadable, unparseable or
 * differently-marked file is not an error but a reason to read the tree and write the file again.
 *
 * WHEN IT IS BELIEVED. Only while the mark it carries is the mark the tree has now: the extent
 * moves when any tail appends, rotates, appears or vanishes, and a sealed segment rewritten
 * changes its fingerprint. That is the evidence the projection kept on disk is believed by
 * (`cache-meta`), with the same limit: an edit in place, to the same size, of a line before the
 * last one of a live segment is not seen here, and is `verify`'s. The mark is read BEFORE the
 * tree is, as the registry reads the extent before a replay, so an append that lands during the
 * read leaves a mark that is behind the tree and is read again next time.
 *
 * WHERE IT IS NOT USED. A tree with no tail has nothing to index, and a tree whose extent could
 * not be read has no mark worth keeping: both are read, every time, as they were.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type ChainLayout,
  chainExtent,
  listTails,
  orderedSegments,
  treeIndexPath,
} from '@mnema/chain';
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
 * The facts of a tree: `remembered` when the tree is still as it was marked there, else the file
 * the tree keeps when it still describes the tree, else `read`, which opens the tree, and the
 * file is then written for the next reader. A tree that cannot carry a mark (no tail yet, or an
 * extent that could not be read) is read each time.
 *
 * Returns the mark with the facts so that a caller that keeps them can pass them back; `mark` is
 * undefined where there was none.
 */
export function treeFactsFrom(
  layout: ChainLayout,
  read: () => TreeFacts,
  remembered?: { readonly mark: string; readonly facts: TreeFacts },
): { readonly mark: string | undefined; readonly facts: TreeFacts } {
  const mark = markOf(layout);
  if (mark === undefined) return { mark, facts: read() };
  if (remembered?.mark === mark) return remembered;
  const held = readIndex(layout);
  if (held?.mark === mark) return held;
  const facts = read();
  writeIndex(layout, { mark, facts });
  return { mark, facts };
}

/** The tree as it stands, or undefined when there is nothing to index or nothing to trust. */
function markOf(layout: ChainLayout): string | undefined {
  const extent = chainExtent(layout);
  if (extent === '' || extent.startsWith('!')) return undefined;
  const sealed: Record<string, string> = {};
  try {
    for (const tail of listTails(layout)) {
      for (const segment of orderedSegments(layout, tail).slice(0, -1))
        sealed[segment] = fingerprintOf(segment);
    }
  } catch {
    return undefined;
  }
  return JSON.stringify({ stamp: productStamp(), extent, sealed });
}

function readIndex(layout: ChainLayout): Marked | undefined {
  try {
    const parsed = JSON.parse(readFileSync(treeIndexPath(layout), 'utf8')) as Partial<Marked>;
    const facts = parsed.facts;
    if (
      typeof parsed.mark !== 'string' ||
      facts === undefined ||
      !Array.isArray(facts.runs) ||
      !Array.isArray(facts.channelSwitches)
    )
      return undefined;
    return { mark: parsed.mark, facts };
  } catch {
    return undefined;
  }
}

/**
 * Written to a name of its own and renamed over the file, so a reader never sees half of one. A
 * tree that cannot be written to (a checkout read-only to this user) simply has no index.
 */
function writeIndex(layout: ChainLayout, index: Marked): void {
  const path = treeIndexPath(layout);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    if (!existsSync(layout.root)) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, JSON.stringify(index));
    renameSync(temporary, path);
  } catch {
    // No index: the next reader reads the tree, which is what it did before there was one.
  }
}
