/**
 * What a projection cache says about itself, so that a cache that outlives the process that
 * built it can be told from one that cannot be trusted.
 *
 * A database that is only ever in memory needs none of this: the process that built it is the
 * process that reads it. A database on disk is read by a process that did not build it, and
 * the only safe question to ask of it is "is this still the chain's projection?" — which this
 * module answers from three things, each of which a stale cache fails differently:
 *
 *   - THE STAMP. What produced the rows: the code that folds and stores them, the schema, and
 *     the version of every kind the chain upcasts to. A cache built by other code is not
 *     wrong about the chain, it is wrong about what THIS code would have written, and the
 *     only repair is to build it again. The stamp is a digest of the projection modules'
 *     own bytes, so a change to a fold invalidates every cache on the machine without
 *     anybody remembering to bump a number.
 *   - THE FRONTIER. How far into the chain the rows reach — per tail, the byte the reading
 *     stopped at and the hash it ended on — which is exactly what `chainArrivals` needs to
 *     say what arrived since, and to say that nothing describes it as a suffix.
 *   - THE FINGERPRINTS. What the frontier cannot see: the bytes BELOW it. A reading that
 *     resumes from a byte never reads what is before it, so a segment rewritten after the
 *     cache was built would be served in silence for as long as the cache lasted — where a
 *     replay reads every line and is told. A sealed segment is never written again, so its
 *     size and modification time are what a rewrite cannot keep; any difference sends the
 *     cache back to a full replay.
 *
 * WHAT THE FINGERPRINTS DO NOT SEE, and the limit is the same one a long-lived session has
 * always had. The ACTIVE segment has only its size checked, since it is still being appended
 * to and its modification time moves legitimately: bytes of it rewritten to the same size are
 * not seen. A sealed segment has size and modification time checked: an edit that restores
 * both is not seen either. The projection is not a tamper detector. Tampering is `verify`'s,
 * which recomputes every hash and checks every signature, and which never reads the
 * projection.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATEST_VERSION, type LinkBreak } from '@mnema/chain';
import type { SqliteDatabase } from '../db/sqlite.js';
import type { ChainFrontier, TailReach } from './order.js';

/** What is stored under the cache's own keys. */
export interface CacheMeta {
  /** What produced the rows ({@link productStamp}). */
  readonly stamp: string;
  /** Moves with every change to the rows, so a writer can tell that another process wrote. */
  readonly generation: number;
  /** How far into the chain the rows reach. */
  readonly frontier: ChainFrontier;
  /** The tails that did not chain, as of the reading that built or last advanced the rows. */
  readonly breaks: readonly LinkBreak[];
  /** Size and modification time of every sealed segment the frontier covers, by path. */
  readonly sealed: Readonly<Record<string, string>>;
}

/** The directories whose code decides what a projection row contains, relative to this file. */
const CODE_THAT_DECIDES_THE_ROWS = ['.', '../db'] as const;

let stamp: string | undefined;

/**
 * A digest of everything that decides what a row of this cache contains, computed once per
 * process: the bytes of the projection and schema modules (compiled or source, whichever is
 * running), and the version every kind of the catalog is read at. Test files, type
 * declarations and source maps are not code that runs, and are left out so that building the
 * documentation of a module does not throw away a cache.
 */
export function productStamp(): string {
  if (stamp !== undefined) return stamp;
  const here = dirname(fileURLToPath(import.meta.url));
  const hash = createHash('sha256');
  for (const relative of CODE_THAT_DECIDES_THE_ROWS) {
    const directory = join(here, relative);
    for (const name of readdirSync(directory).sort()) {
      if (!/\.(?:js|ts)$/.test(name) || /\.test\.|\.d\.ts$/.test(name)) continue;
      hash.update(`${relative}/${name}\0`);
      hash.update(readFileSync(join(directory, name)));
      hash.update('\0');
    }
  }
  hash.update(JSON.stringify(LATEST_VERSION));
  stamp = hash.digest('hex').slice(0, 32);
  return stamp;
}

/** Reads what the cache says about itself, or undefined when it says nothing (a fresh file). */
export function readMeta(db: SqliteDatabase): CacheMeta | undefined {
  const rows = db.prepare('SELECT key, value FROM cache_meta').all() as {
    key: string;
    value: string;
  }[];
  if (rows.length === 0) return undefined;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const stampHere = byKey.get('stamp');
  const generation = byKey.get('generation');
  const frontier = byKey.get('frontier');
  const breaks = byKey.get('breaks');
  const sealed = byKey.get('sealed');
  if (
    stampHere === undefined ||
    generation === undefined ||
    frontier === undefined ||
    breaks === undefined ||
    sealed === undefined
  ) {
    return undefined;
  }
  return {
    stamp: stampHere,
    generation: Number(generation),
    frontier: decodeFrontier(frontier),
    breaks: JSON.parse(breaks) as LinkBreak[],
    sealed: JSON.parse(sealed) as Record<string, string>,
  };
}

/** The counter alone — what a writer asks, inside its transaction, before it writes. */
export function readGeneration(db: SqliteDatabase): number {
  const row = db.prepare("SELECT value FROM cache_meta WHERE key = 'generation'").get() as
    | { value: string }
    | undefined;
  return row === undefined ? -1 : Number(row.value);
}

/** Stores what the cache says about itself, all at once. */
export function writeMeta(db: SqliteDatabase, meta: CacheMeta): void {
  const put = db.prepare('INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)');
  put.run('stamp', meta.stamp);
  put.run('generation', String(meta.generation));
  put.run('frontier', encodeFrontier(meta.frontier));
  put.run('breaks', JSON.stringify(meta.breaks));
  put.run('sealed', JSON.stringify(meta.sealed));
}

function encodeFrontier(frontier: ChainFrontier): string {
  return JSON.stringify({
    events: frontier.events,
    tails: [...frontier.tails],
    unresolved: frontier.unresolved,
  });
}

function decodeFrontier(stored: string): ChainFrontier {
  const parsed = JSON.parse(stored) as {
    events: number;
    tails: [string, TailReach][];
    unresolved?: string[];
  };
  return {
    events: parsed.events,
    tails: new Map(parsed.tails),
    unresolved: parsed.unresolved ?? [],
  };
}

/**
 * The fingerprint of every SEALED segment the frontier covers — every segment of a tail but
 * the one it was last appending to — as `<size>:<mtimeMs>`, by path.
 *
 * A segment that cannot be stat'ed is recorded as such rather than skipped, so that it is
 * a difference the day it can.
 */
export function sealedFingerprints(frontier: ChainFrontier): Readonly<Record<string, string>> {
  const fingerprints: Record<string, string> = {};
  for (const reach of frontier.tails.values()) {
    for (const segment of reach.segments.slice(0, -1))
      fingerprints[segment] = fingerprintOf(segment);
  }
  return fingerprints;
}

/** Whether every sealed segment a cache recorded is still the file it recorded. */
export function sealedSegmentsHold(recorded: Readonly<Record<string, string>>): boolean {
  for (const [segment, fingerprint] of Object.entries(recorded)) {
    if (fingerprintOf(segment) !== fingerprint) return false;
  }
  return true;
}

function fingerprintOf(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'unreadable';
  }
}
