/**
 * The append-only writer for one machine's tail.
 *
 * A writer owns exactly one tail: it appends events as sealed entries, chains
 * each to its predecessor, seals a segment once it passes the size cap, and
 * signs a checkpoint every so often. Because each machine writes only its own
 * tail, there is never an in-file merge — concurrency across machines is
 * resolved by reading many tails, not by locking one file.
 *
 * State (head hash, next seq, current segment) is recovered from disk on
 * construction, so a fresh process continues an existing tail correctly.
 */

import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CatalogEvent } from '../events/catalog.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { type Checkpoint, serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { type Entry, sealEntry, serializeEntry } from './entry.js';
import type { KeyPair } from './keys.js';
import { type ChainLayout, checkpointsPath, segmentPath, tailDir } from './layout.js';
import { orderedSegments, readTailCheckpoints, readTailEntries } from './store.js';

/** Seal a segment once it grows past this many bytes (P4: by size). */
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

  private readonly maxSegmentBytes: number;
  private readonly checkpointEvery: number;

  constructor(
    private readonly layout: ChainLayout,
    private readonly keyPair: KeyPair,
    private readonly upcasters: UpcasterRegistry,
    options: WriterOptions = {},
  ) {
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    this.checkpointEvery = options.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY;
    mkdirSync(tailDir(layout, this.tailId), { recursive: true });
    this.recover();
  }

  /** The tail id is the machine's fingerprint — one tail per key. */
  private get tailId(): string {
    return this.keyPair.fingerprint;
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
      this.segmentBytes = statSync(lastSegment).size;
    }
    const lastCp = readTailCheckpoints(this.layout, this.tailId).at(-1);
    if (lastCp !== undefined) this.lastCheckpointedSeq = lastCp.toSeq;
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
      keyPair: this.keyPair,
    });
    const path = checkpointsPath(this.layout, this.tailId);
    ensureDir(path);
    appendFileSync(path, `${serializeCheckpoint(checkpoint)}\n`, 'utf-8');
    this.lastCheckpointedSeq = toSeq;
    return checkpoint;
  }
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
