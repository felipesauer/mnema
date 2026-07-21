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
  keysDir,
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

/**
 * Lists the fingerprints of the committed public keys (each `<fingerprint>.pub`
 * under `keys/`). Because a public key is written before a machine's first
 * event and its fingerprint IS its tail id, this set is a committed census of
 * the tails that ought to exist — the verifier crosses it against the tails
 * actually present to notice a tail that went missing while its key stayed.
 */
export function listPublicKeyFingerprints(layout: ChainLayout): string[] {
  const dir = keysDir(layout);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.pub'))
    .map((name) => name.slice(0, -'.pub'.length))
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
 * Reads all entries of a tail in seq order across its segments.
 *
 * A malformed line is corruption worth surfacing — EXCEPT one specific,
 * benign case: a crash mid-append can leave a torn final line at the physical
 * end of the last segment. A complete append always ends in a newline, so a
 * torn write is exactly "the file does not end in a newline and its last line
 * fails to parse". That one trailing fragment is dropped so the intact prefix
 * still reads and the writer can resume; any malformed line elsewhere (or a
 * torn fragment that happens to parse) still throws.
 */
export function readTailEntries(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
): Entry[] {
  const entries: Entry[] = [];
  const segments = orderedSegments(layout, tailId);
  for (let s = 0; s < segments.length; s += 1) {
    const file = segments[s] as string;
    const raw = readFileSync(file, 'utf-8');
    const isLastSegment = s === segments.length - 1;
    // A trailing fragment (no final newline) only exists on the last segment.
    const endsWithNewline = raw.endsWith('\n');
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as string;
      if (line.length === 0) continue;
      const isTrailingFragment = isLastSegment && !endsWithNewline && i === lines.length - 1;
      try {
        entries.push(parseEntry(line, upcasters));
      } catch (error) {
        if (isTrailingFragment) continue; // torn last write from a crash — drop it
        throw error;
      }
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
