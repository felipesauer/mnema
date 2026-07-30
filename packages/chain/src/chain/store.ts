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
import { parsedFromEnd, parseStoredLine } from './lines.js';

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
 * Parses one segment file into its entries, whole and in seq order.
 *
 * `isLast` says whether this is the tail's last segment, because that is the
 * only file whose end is the physical end of the tail — see
 * {@link parseStoredLine}, which owns the torn-fragment rule this passes it.
 */
function entriesOfSegment(file: string, upcasters: UpcasterRegistry, isLast: boolean): Entry[] {
  const raw = readFileSync(file, 'utf-8');
  const endsWithNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  const entries: Entry[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.length === 0) continue;
    const couldBeTorn = isLast && !endsWithNewline && i === lines.length - 1;
    const entry = parseStoredLine(line, couldBeTorn, (stored) => parseEntry(stored, upcasters));
    if (entry !== null) entries.push(entry);
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
 * walks segments from last to first and, INSIDE each one, lines from last to
 * first — stopping at the first entry it meets at or below `minSeq`, because
 * seqs only rise along the tail, so everything above the boundary is by then in
 * hand and nothing earlier can hold more.
 *
 * That boundary entry is kept rather than dropped, and it is the only one at or
 * below `minSeq` the result can contain. It is what gives a FULLY covered tail
 * its head: with nothing left to sign, the last entry is still the link the next
 * append chains to. A caller that wants strictly-above therefore filters.
 *
 * The cost is the entries actually returned, not the file they sit in: a covered
 * tail costs one line however many megabytes the segment weighs. Passing
 * `minSeq = -1` (a tail with no checkpoint yet) reads the whole tail, which is
 * the honest answer — the next checkpoint has to cover from seq 0.
 *
 * Torn-fragment tolerance is exactly {@link readTailEntries}'s: both reach
 * {@link parseStoredLine}.
 */
export function readTailTip(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
  minSeq: number,
): Entry[] {
  const segments = orderedSegments(layout, tailId);
  const tip: Entry[] = [];
  for (let s = segments.length - 1; s >= 0; s -= 1) {
    const file = segments[s] as string;
    const parse = (line: string): Entry => parseEntry(line, upcasters);
    let reachedCoverage = false;
    // An empty segment yields nothing and moves no boundary — the last one can
    // be empty because a recovering writer truncated a torn fragment out of it,
    // and the walk simply continues into the segment before it.
    for (const entry of parsedFromEnd(file, s === segments.length - 1, parse)) {
      tip.push(entry);
      if (entry.link.seq <= minSeq) {
        reachedCoverage = true;
        break;
      }
    }
    if (reachedCoverage) break;
  }
  return tip.reverse();
}

/**
 * Reads a tail's checkpoints in stored order.
 *
 * The verifier needs every one of them — it walks the checkpoint chain and
 * checks that the coverage is contiguous — so this reads the whole file. A
 * writer resuming the tail needs only the last, and takes it from
 * {@link lastTailCheckpoint} instead.
 *
 * Torn-fragment tolerance is {@link parseStoredLine}'s: a crash while signing a
 * checkpoint can leave a partial final line, and without the tolerance BOTH the
 * verifier and the writer's own recovery would throw — the machine could neither
 * verify nor resume its own tail after a crash mid-checkpoint.
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
    const couldBeTorn = !endsWithNewline && i === lines.length - 1;
    const checkpoint = parseStoredLine(line, couldBeTorn, parseCheckpoint);
    if (checkpoint !== null) checkpoints.push(checkpoint);
  }
  return checkpoints;
}

/**
 * Reads the LAST checkpoint stored for a tail, or `undefined` if it has none.
 *
 * This is what a resuming writer asks for: how far the coverage reaches and
 * which hash the next checkpoint links to. It answers by walking the file
 * backwards and stopping at the first line that parses — one line, whatever the
 * file weighs. Because a checkpoint is signed after every write in this product,
 * that file grows one line per event, and reading it whole to take its last line
 * put an unbounded cost on every single write.
 *
 * The answer is the last line STORED, which is what taking the last of
 * {@link readTailCheckpoints} means, not the highest `toSeq`. For a tail with one
 * writer the two coincide — the verifier sorts by defence, not because the file
 * is out of order — and picking the highest instead would be a change of
 * behaviour wearing an optimization's clothes.
 *
 * The one thing it cannot see is corruption further up: a malformed line in the
 * MIDDLE of the file makes {@link readTailCheckpoints} throw and leaves this
 * indifferent, because it never reads that far. That is the same trade the tip
 * already makes for segments, and it costs no proof — the verifier reads every
 * checkpoint and is what reports the file.
 */
export function lastTailCheckpoint(layout: ChainLayout, tailId: string): Checkpoint | undefined {
  const file = checkpointsPath(layout, tailId);
  if (!existsSync(file)) return undefined;
  for (const checkpoint of parsedFromEnd(file, true, parseCheckpoint)) return checkpoint;
  return undefined;
}
