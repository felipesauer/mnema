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
import { describeLinkBreak, type Entry, linkBreakAt, parseEntry } from './entry.js';
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

/**
 * Whether a chain root holds a RECORD at all — a tail, or a committed public key.
 *
 * The question a verifier asks before ruling on a tree it was merely NAMED: three
 * trees are named for every project (the committed one, this machine's private one,
 * the machine-global one) and a tree nothing was ever written to has no directory,
 * so a verdict over it would be a verdict over nothing. False here means there is
 * nothing to rule on; it never means a tree is in order.
 *
 * A COMMITTED KEY COUNTS, and that is the whole reason this is not
 * `listTails(...).length > 0`. A key is written before its machine's first event and
 * its fingerprint IS its tail id, so a root with keys and no tails is precisely the
 * shape of a tail that went missing — the census note exists to say so
 * (`key-without-tail`), and answering "nothing here" would silence it. Only a root
 * with neither has nothing to say.
 *
 * Cheap by construction: two directory listings, no segment is parsed. It is asked
 * INSTEAD of a verification, never before one that then runs anyway.
 */
export function holdsRecord(layout: ChainLayout): boolean {
  return listTails(layout).length > 0 || listPublicKeyFingerprints(layout).length > 0;
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

/** What one segment file held: its entries, and whether its end was a partial write. */
interface SegmentRead {
  readonly entries: Entry[];
  /** The file's last line was dropped by the torn-fragment rule. */
  readonly partialFinalLine: boolean;
}

/**
 * Parses one segment file into its entries, whole and in seq order.
 *
 * `isLast` says whether this is the tail's last segment, because that is the
 * only file whose end is the physical end of the tail — see
 * {@link parseStoredLine}, which owns the torn-fragment rule this passes it.
 *
 * It also REPORTS the tolerance it used. The rule drops a torn fragment so the
 * intact prefix still reads, which is right; dropping it in silence is what left
 * garbage at the end of a tail indistinguishable from a tail that simply ended
 * there. Whoever needs to say so gets the fact from here rather than deciding for
 * itself whether the last line looks torn — a second reading of that rule could
 * disagree with this one.
 */
function entriesOfSegment(file: string, upcasters: UpcasterRegistry, isLast: boolean): SegmentRead {
  const raw = readFileSync(file, 'utf-8');
  const endsWithNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  const entries: Entry[] = [];
  let partialFinalLine = false;
  // Hoisted over the loop: the locus costs nothing per line and is read only when
  // a line refuses to parse. See {@link parseStoredLine}.
  let at = 0;
  const where = (): string => `${file} line ${at}`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.length === 0) continue;
    const couldBeTorn = isLast && !endsWithNewline && i === lines.length - 1;
    at = i + 1;
    const entry = parseStoredLine(
      line,
      couldBeTorn,
      (stored) => parseEntry(stored, upcasters),
      where,
    );
    if (entry !== null) entries.push(entry);
    else partialFinalLine = true;
  }
  return { entries, partialFinalLine };
}

/** Where a tail stops chaining, and what is wrong there. */
export interface LinkBreak {
  readonly tail: string;
  /** The seq of the entry that does not follow the one before it. */
  readonly seq: number;
  /** The same sentence the verifier's T1 issue carries — see {@link linkBreakAt}. */
  readonly detail: string;
}

/** What a whole tail held: its entries, and what the read had to tolerate. */
export interface TailRead {
  readonly entries: Entry[];
  /**
   * The tail's last line was a partial write, dropped by the torn-fragment rule.
   * Ambiguous by nature — an interrupted append leaves exactly this, and so does
   * an attempt to append garbage — which is why it is REPORTED rather than judged.
   */
  readonly partialFinalLine: boolean;
  /**
   * The first place the tail stops chaining, if it does — a duplicate seq, a gap, an
   * entry whose `prev` names something else, an entry stored under a tail it does not
   * name.
   *
   * REPORTED, NOT THROWN, and not dropped either. Throwing would take the whole
   * record away over a break that costs no fact: every event above and below a
   * duplicate seq is still on disk, still readable, still the thing somebody wrote —
   * what a break destroys is the PROOF that nothing was inserted. Dropping it is what
   * the reads used to do, and it is why a chain `verify` exits 1 over could be
   * searched, listed and summarised with no word about it anywhere.
   *
   * It is the FIRST break and not all of them: past it, every later seq and `prev` is
   * measured against an expectation the break already invalidated, so a list would be
   * a list of consequences. The verdict that enumerates belongs to `verify`.
   */
  readonly linkBreak?: LinkBreak;
}

/**
 * Reads a whole tail: every entry in seq order across its segments, whether its
 * physical end was a fragment the read had to drop, and whether it CHAINS.
 *
 * The verifier is what needs the second half — it has to report what it could not
 * check — and everything else only wants the entries ({@link readTailEntries}).
 * Both walk this one function, so a reader cannot see a different tail than the
 * verdict was formed over.
 *
 * The third half is new, and it is the half that makes that sentence true rather than
 * merely tidy: reading the same bytes is not the same as reaching the same conclusion
 * about them. The link check here is the verifier's own ({@link linkBreakAt}), so a
 * reader cannot be more lenient than the verdict; it costs three comparisons per
 * entry and no hash, which is why a read can afford it and a signature check is still
 * `verify`'s alone.
 */
export function readTail(
  layout: ChainLayout,
  tailId: string,
  upcasters: UpcasterRegistry,
): TailRead {
  const segments = orderedSegments(layout, tailId);
  const entries: Entry[] = [];
  let partialFinalLine = false;
  for (let s = 0; s < segments.length; s += 1) {
    const file = segments[s] as string;
    const read = entriesOfSegment(file, upcasters, s === segments.length - 1);
    for (const entry of read.entries) entries.push(entry);
    if (read.partialFinalLine) partialFinalLine = true;
  }
  const linkBreak = firstLinkBreak(tailId, entries);
  return linkBreak === undefined
    ? { entries, partialFinalLine }
    : { entries, partialFinalLine, linkBreak };
}

/** The first entry that does not follow the one before it, asked of the shared rule. */
function firstLinkBreak(tailId: string, entries: readonly Entry[]): LinkBreak | undefined {
  let expectedSeq = 0;
  let expectedPrev: string | null = null;
  for (const entry of entries) {
    const broke = linkBreakAt(tailId, entry, expectedSeq, expectedPrev);
    if (broke !== undefined) {
      return { tail: tailId, seq: entry.link.seq, detail: describeLinkBreak(broke) };
    }
    expectedPrev = entry.link.hash;
    expectedSeq += 1;
  }
  return undefined;
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
  return readTail(layout, tailId, upcasters).entries;
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
  let at = 0;
  const where = (): string => `${file} line ${at}`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.length === 0) continue;
    const couldBeTorn = !endsWithNewline && i === lines.length - 1;
    at = i + 1;
    const checkpoint = parseStoredLine(line, couldBeTorn, parseCheckpoint, where);
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
 * MIDDLE of the file makes {@link readTailCheckpoints} refuse and leaves this
 * indifferent, because it never reads that far. That is the same trade the tip
 * already makes for segments, and it costs no proof — the verifier reads every
 * checkpoint, and it is what turns an unreadable one into a verdict naming the
 * file and the line.
 */
export function lastTailCheckpoint(layout: ChainLayout, tailId: string): Checkpoint | undefined {
  const file = checkpointsPath(layout, tailId);
  if (!existsSync(file)) return undefined;
  for (const checkpoint of parsedFromEnd(file, true, parseCheckpoint)) return checkpoint;
  return undefined;
}
