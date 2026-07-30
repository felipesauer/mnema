/**
 * Reading a chain from disk: enumerate tails, read a tail's entries in seq order
 * across its segments — the whole history, or just the end of it — and read its
 * checkpoints.
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
 * Parses one segment file into its entries.
 *
 * A malformed line is corruption worth surfacing — EXCEPT one specific,
 * benign case: a crash mid-append can leave a torn final line at the physical
 * end of the last segment. A complete append always ends in a newline, so a
 * torn write is exactly "the file does not end in a newline and its last line
 * fails to parse". That one trailing fragment is dropped so the intact prefix
 * still reads and the writer can resume; any malformed line elsewhere (or a
 * torn fragment that happens to parse) still throws.
 *
 * `isLast` says whether this is the tail's last segment, because that is the
 * only file whose end is the physical end of the tail — a fragment anywhere
 * else is corruption. This is the ONE place the rule lives: both readers below
 * go through here, so the tolerance cannot drift between them.
 */
function entriesOfSegment(file: string, upcasters: UpcasterRegistry, isLast: boolean): Entry[] {
  const raw = readFileSync(file, 'utf-8');
  const endsWithNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  const entries: Entry[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.length === 0) continue;
    const isTrailingFragment = isLast && !endsWithNewline && i === lines.length - 1;
    try {
      entries.push(parseEntry(line, upcasters));
    } catch (error) {
      if (isTrailingFragment) continue; // torn last write from a crash — drop it
      throw error;
    }
  }
  return entries;
}

/**
 * Reads all entries of a tail in seq order across its segments.
 *
 * This is the whole history of one machine, which the verifier and the replay
 * both genuinely need. A writer resuming the tail does not — see
 * {@link readTailTip}.
 */
export function readTailEntries(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
): Entry[] {
  const segments = orderedSegments(layout, tailId);
  const entries: Entry[] = [];
  for (let s = 0; s < segments.length; s += 1) {
    const file = segments[s] as string;
    for (const entry of entriesOfSegment(file, upcasters, s === segments.length - 1)) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Reads the entries at the END of a tail: enough of it to hold every seq above
 * `minSeq`, in seq order.
 *
 * A writer resuming a tail needs two things, and neither needs the history: the
 * last entry (for the head hash and the next seq) and the events no checkpoint
 * covers yet (for what the next checkpoint signs). Both live at the end. So this
 * walks segments from last to first: the last segment that yields any entry
 * already holds the tail's last entry, and because segments are in seq order the
 * lowest seq in hand only ever drops as the walk goes back — once it is at or
 * below `minSeq`, everything above `minSeq` is in hand and no earlier segment
 * can hold more.
 *
 * The unit of reading is a whole segment, so the result MAY include entries at
 * or below `minSeq`; a caller that wants strictly-above filters. What bounds the
 * excess is the segment size cap: never more than one segment's worth below the
 * boundary. Passing `minSeq = -1` (a tail with no checkpoint yet) reads the whole
 * tail, which is the honest answer — the next checkpoint has to cover from seq 0.
 *
 * Torn-fragment tolerance is exactly {@link readTailEntries}'s: both compose
 * `entriesOfSegment`.
 */
export function readTailTip(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
  minSeq: number,
): Entry[] {
  const segments = orderedSegments(layout, tailId);
  const chunks: Entry[][] = [];
  let lowestSeq: number | null = null;
  for (let s = segments.length - 1; s >= 0; s -= 1) {
    const file = segments[s] as string;
    const chunk = entriesOfSegment(file, upcasters, s === segments.length - 1);
    // An empty segment contributes nothing and moves no boundary — the last one
    // can be empty because a recovering writer truncated a torn fragment out of
    // it, and the walk simply continues into the segment before it.
    if (chunk.length > 0) {
      chunks.unshift(chunk);
      lowestSeq = (chunk[0] as Entry).link.seq;
    }
    if (lowestSeq !== null && lowestSeq <= minSeq) break;
  }
  return chunks.flat();
}

/**
 * Reads a tail's checkpoints in stored order.
 *
 * Like {@link readTailEntries}, this tolerates ONE benign case: a crash while
 * signing a checkpoint can leave a torn final line (no trailing newline) at the
 * end of the append-only checkpoints file. A complete checkpoint append always
 * ends in a newline, so a torn write is exactly "the file does not end in a
 * newline and its last line fails to parse". That one trailing fragment is
 * dropped so the intact checkpoints still read; any malformed line elsewhere
 * still throws. Without this, a torn checkpoint would make BOTH the verifier and
 * the writer's own recovery throw — the machine could neither verify nor resume
 * its own tail after a crash mid-checkpoint.
 */
export function readTailCheckpoints(layout: ChainLayout, tailId: string): Checkpoint[] {
  const file = checkpointsPath(layout, tailId);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf-8');
  const endsWithNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.length === 0) continue;
    const isTrailingFragment = !endsWithNewline && i === lines.length - 1;
    try {
      checkpoints.push(parseCheckpoint(line));
    } catch (error) {
      if (isTrailingFragment) continue; // torn last checkpoint from a crash — drop it
      throw error;
    }
  }
  return checkpoints;
}
