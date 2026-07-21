/**
 * Reading a chain from disk: enumerate tails, read a tail's entries in order
 * across its segments, and read its checkpoints.
 *
 * Reading is pure I/O plus parsing; it does no verification. The verifier
 * layers the T1/T2/T4 checks on top of what this returns.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';

import type { UpcasterRegistry } from '../events/upcaster.js';
import { type Checkpoint, parseCheckpoint } from './checkpoint.js';
import { type Entry, parseEntry } from './entry.js';
import {
  type ChainLayout,
  checkpointsPath,
  isSegmentFile,
  segmentNumberOf,
  tailDir,
  tailsDir,
} from './layout.js';

/** Lists the tail ids present in a chain (each is one machine's directory). */
export function listTails(layout: ChainLayout): string[] {
  const dir = tailsDir(layout);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The sealed + current segment files of a tail, in segment order. */
export function orderedSegments(layout: ChainLayout, tailId: string): string[] {
  const dir = tailDir(layout, tailId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isSegmentFile)
    .sort((a, b) => segmentNumberOf(a) - segmentNumberOf(b))
    .map((name) => `${dir}/${name}`);
}

/**
 * Reads all entries of a tail in seq order across its segments. Skips blank
 * lines; a malformed line throws (a tail's segments are our own append-only
 * output, so a parse failure is corruption worth surfacing, not tolerating).
 */
export function readTailEntries(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
): Entry[] {
  const entries: Entry[] = [];
  for (const file of orderedSegments(layout, tailId)) {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (line.length === 0) continue;
      entries.push(parseEntry(line, upcasters));
    }
  }
  return entries;
}

/** Reads a tail's checkpoints in stored order. */
export function readTailCheckpoints(layout: ChainLayout, tailId: string): Checkpoint[] {
  const file = checkpointsPath(layout, tailId);
  if (!existsSync(file)) return [];
  const checkpoints: Checkpoint[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (line.length === 0) continue;
    checkpoints.push(parseCheckpoint(line));
  }
  return checkpoints;
}
