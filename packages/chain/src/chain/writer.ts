/**
 * The append-only writer for one machine's tail.
 *
 * A writer owns exactly one tail: it appends events as sealed entries, chains
 * each to its predecessor, seals a segment once it passes the size cap, and
 * signs a checkpoint every so often. Because each machine writes only its own
 * tail, there is never an in-file merge — concurrency across machines is
 * resolved by reading many tails, not by locking one file.
 *
 * The tail id pairs the signing key's fingerprint with this installation's id,
 * `<fingerprint>-<installationId>`. WHO a writer speaks for (the anchor) and
 * WHICH key signs (the signer fingerprint) still come from the key alone, so
 * two installations of one copied key share an identity but keep distinct tails
 * — copying a key across machines no longer collides one tail onto another.
 *
 * State (head hash, next seq, current segment) is recovered from disk on
 * construction, so a fresh process continues an existing tail correctly.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CatalogEvent } from '../events/catalog.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import {
  type Checkpoint,
  checkpointHash,
  serializeCheckpoint,
  signCheckpoint,
} from './checkpoint.js';
import { type Entry, sealEntry, serializeEntry } from './entry.js';
import { deriveAnchor, type KeyPair } from './keys.js';
import { type ChainLayout, checkpointsPath, segmentPath, tailDir } from './layout.js';
import { orderedSegments, readTailCheckpoints, readTailEntries } from './store.js';

/** Seal a segment once it grows past this many bytes (segments rotate by size). */
export const DEFAULT_MAX_SEGMENT_BYTES = 4 * 1024 * 1024;

/** Sign a checkpoint after this many uncheckpointed events. */
export const DEFAULT_CHECKPOINT_EVERY = 64;

export interface WriterOptions {
  readonly maxSegmentBytes?: number;
  readonly checkpointEvery?: number;
}

export class ChainWriter {
  private head: string | null = null;
  private nextSeq = 0;
  private segment = 1;
  private segmentBytes = 0;
  /** Seq of the last event covered by a checkpoint, or -1 if none. */
  private lastCheckpointedSeq = -1;
  /** Hash of the last checkpoint, or null if none — the link the next one signs. */
  private lastCheckpointHash: string | null = null;

  private readonly maxSegmentBytes: number;
  private readonly checkpointEvery: number;

  private readonly tailId: string;

  constructor(
    private readonly layout: ChainLayout,
    private readonly keyPair: KeyPair,
    installationId: string,
    private readonly upcasters: UpcasterRegistry,
    options: WriterOptions = {},
  ) {
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    this.checkpointEvery = options.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY;
    this.tailId = `${keyPair.fingerprint}-${installationId}`;
    mkdirSync(tailDir(layout, this.tailId), { recursive: true });
    this.recover();
  }

  /**
   * The full fingerprint of the key this writer signs with — the `signerFp`
   * every event it writes must carry, and the same key its checkpoints bind.
   * Exposed so the operation that builds an event stamps the identity from the
   * very key that will sign it, never a value passed in from elsewhere.
   */
  get signerFingerprint(): string {
    return this.keyPair.fingerprint;
  }

  /**
   * The anchor id this writer authorizes as — WHO its events speak for,
   * `mnid:<hash>` derived from the signing key. A caller cannot supply it; the
   * operation reads it here so identity is derived from the local key, not
   * chosen, and is unique by construction across clones.
   */
  get anchor(): string {
    return deriveAnchor(this.keyPair.fingerprint);
  }

  /**
   * Recovers writer state from disk: the last entry gives the head hash and the
   * next seq; the highest segment file gives the current segment and its size;
   * the last checkpoint gives the last checkpointed seq.
   */
  private recover(): void {
    const entries = readTailEntries(this.layout, this.tailId, this.upcasters);
    const last = entries.at(-1);
    if (last !== undefined) {
      this.head = last.link.hash;
      this.nextSeq = last.link.seq + 1;
    }
    const segments = orderedSegments(this.layout, this.tailId);
    const lastSegment = segments.at(-1);
    if (lastSegment !== undefined) {
      const match = /(\d+)\.jsonl$/.exec(lastSegment);
      this.segment = match ? Number.parseInt(match[1] as string, 10) : 1;
      // Truncate any torn trailing fragment before resuming. A crash mid-append
      // leaves a partial line with no newline at the end of the segment.
      // readTailEntries tolerates it ON READ (drops it), but if we resumed
      // writing after it, the next complete `...\n` would land AFTER the
      // fragment — turning the once-benign torn line into a mid-file malformed
      // line that every later read throws on. So a recovering writer heals the
      // file: it truncates back to the end of the last COMPLETE line, so the
      // next append continues a clean tail. A complete append always ends in a
      // newline, so this only ever removes a genuine crash fragment.
      this.segmentBytes = healTornTail(lastSegment);
    }
    const lastCp = readTailCheckpoints(this.layout, this.tailId).at(-1);
    if (lastCp !== undefined) {
      this.lastCheckpointedSeq = lastCp.toSeq;
      this.lastCheckpointHash = checkpointHash(lastCp);
    }
  }

  /**
   * Appends an event to the tail. Seals the current segment first if it has
   * passed the size cap, so a single entry never straddles two segments. Signs
   * a checkpoint when enough uncheckpointed events have accumulated.
   */
  append(event: CatalogEvent): Entry {
    if (this.segmentBytes >= this.maxSegmentBytes) {
      this.segment += 1;
      this.segmentBytes = 0;
    }
    const entry = sealEntry({
      event,
      tail: this.tailId,
      seq: this.nextSeq,
      prev: this.head,
    });
    const line = `${serializeEntry(entry)}\n`;
    const path = segmentPath(this.layout, this.tailId, this.segment);
    appendFileSync(path, line, 'utf-8');

    this.head = entry.link.hash;
    this.nextSeq += 1;
    this.segmentBytes += Buffer.byteLength(line, 'utf-8');

    this.maybeCheckpoint();
    return entry;
  }

  /**
   * Appends several events as one atomic unit: either every line reaches the
   * tail or none does. The entries are sealed and chained in memory, serialized
   * together, and written with a SINGLE append — so a birth pair (a
   * `task.created` and its transition) can never land half-written, leaving a
   * created task with no state. A crash mid-write can still tear the LAST line
   * of the buffer, which the reader tolerates as an unterminated final entry, so
   * the atom is "all-or-nothing" up to that already-handled tail case.
   *
   * The whole batch goes into one segment (rotating first if the current one is
   * full), so no entry in the batch straddles a segment boundary.
   */
  appendAll(events: readonly CatalogEvent[]): Entry[] {
    if (events.length === 0) return [];
    if (this.segmentBytes >= this.maxSegmentBytes) {
      this.segment += 1;
      this.segmentBytes = 0;
    }
    const entries: Entry[] = [];
    let prev = this.head;
    let seq = this.nextSeq;
    let lines = '';
    for (const event of events) {
      const entry = sealEntry({ event, tail: this.tailId, seq, prev });
      const line = `${serializeEntry(entry)}\n`;
      entries.push(entry);
      lines += line;
      prev = entry.link.hash;
      seq += 1;
    }
    const path = segmentPath(this.layout, this.tailId, this.segment);
    appendFileSync(path, lines, 'utf-8');

    this.head = prev;
    this.nextSeq = seq;
    this.segmentBytes += Buffer.byteLength(lines, 'utf-8');

    this.maybeCheckpoint();
    return entries;
  }

  /**
   * Signs a checkpoint over the uncheckpointed tail if enough events have
   * accumulated. Coverage stays contiguous: each checkpoint starts at the seq
   * right after the previous one's end.
   */
  private maybeCheckpoint(): void {
    const uncovered = this.nextSeq - 1 - this.lastCheckpointedSeq;
    if (uncovered < this.checkpointEvery) return;
    this.checkpoint();
  }

  /**
   * Signs a checkpoint over every uncheckpointed event now. Public so a caller
   * can force a checkpoint (e.g. at shutdown) to shrink the uncovered window.
   */
  checkpoint(): Checkpoint | null {
    const fromSeq = this.lastCheckpointedSeq + 1;
    const toSeq = this.nextSeq - 1;
    if (toSeq < fromSeq) return null;
    const entries = readTailEntries(this.layout, this.tailId, this.upcasters);
    const events = entries.filter((e) => e.link.seq >= fromSeq && e.link.seq <= toSeq);
    const checkpoint = signCheckpoint({
      tail: this.tailId,
      fromSeq,
      events: events.map((e) => e.event),
      prev: this.lastCheckpointHash,
      keyPair: this.keyPair,
    });
    const path = checkpointsPath(this.layout, this.tailId);
    ensureDir(path);
    appendFileSync(path, `${serializeCheckpoint(checkpoint)}\n`, 'utf-8');
    this.lastCheckpointedSeq = toSeq;
    this.lastCheckpointHash = checkpointHash(checkpoint);
    return checkpoint;
  }
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Heals a segment's torn trailing fragment and returns the size to resume from.
 * If the file ends in a newline it is intact — its full size is returned and
 * nothing is written. Otherwise a crash left a partial final line: the file is
 * truncated back to just after the last newline (or to empty if there is none),
 * and that length is returned, so the next append continues a clean tail.
 *
 * Works in bytes, not characters: the truncation offset is the byte after the
 * last `\n`, so a multi-byte UTF-8 character split across the crash boundary is
 * removed whole with the rest of the fragment.
 */
function healTornTail(segmentPath: string): number {
  const bytes = readFileSync(segmentPath);
  if (bytes.length === 0) return 0;
  if (bytes[bytes.length - 1] === 0x0a) return bytes.length; // ends in newline: intact
  const lastNewline = bytes.lastIndexOf(0x0a);
  const keep = lastNewline + 1; // 0 when there is no newline at all
  truncateSync(segmentPath, keep);
  return keep;
}
