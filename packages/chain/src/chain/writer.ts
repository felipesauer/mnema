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
 * `<fingerprint>-<installationId>`. WHICH key signs (the signer fingerprint)
 * comes from the key; WHO the writer speaks for (the anchor) is read from local
 * material — the anchor this installation founded (its own) or enrolled into
 * (another key's), or, until one is recorded, the anchor it will found. Recording
 * that anchor and emitting the founding is the identity operation's job, not the
 * writer's; the writer only exposes the material (`anchor`, `hasAnchor`,
 * `recordAnchor`) so that operation can found a fresh installation before its
 * first fact.
 *
 * State (head hash, next seq, current segment, and the events no checkpoint
 * covers yet) is recovered from the END of the tail on construction, so a fresh
 * process continues an existing tail correctly without re-reading its history.
 */

import { appendFileSync, existsSync, mkdirSync, truncateSync, writeFileSync } from 'node:fs';
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
import { readAnchor, writeAnchor } from './keystore.js';
import {
  type ChainLayout,
  checkpointsPath,
  segmentPath,
  tailDir,
  tailProofPath,
} from './layout.js';
import { linesFromEnd } from './lines.js';
import { lastTailCheckpoint, orderedSegments, readTailTip } from './store.js';
import { serializeTailProof, signTailProof } from './tailproof.js';

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
  /**
   * The events appended since the last checkpoint, in seq order — exactly what
   * the next checkpoint signs. Held in memory so signing never round-trips
   * through the store: the writer already knows what it appended, and a fresh
   * process refills this from the END of the tail in `recover()`. Without it,
   * signing a range of one or two events re-read and re-parsed the whole tail,
   * making a run of N writes cost O(N²).
   */
  private pending: CatalogEvent[] = [];

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
    this.ensureTailProof();
    this.recover();
  }

  /**
   * Writes this tail's proof of ownership once, at birth: the key signs a
   * statement naming its own tail id, so the verifier can tie the locally-chosen
   * installation-id suffix to the key that owns it. Idempotent — a reopened tail
   * already has one — and never overwrites, so it costs nothing after birth.
   */
  private ensureTailProof(): void {
    const path = tailProofPath(this.layout, this.tailId);
    if (existsSync(path)) return;
    const proof = signTailProof(this.tailId, this.keyPair);
    writeFileSync(path, `${serializeTailProof(proof)}\n`, 'utf-8');
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
   * The anchor id this writer authorizes as — WHO its events speak for. Read
   * from LOCAL material (`keys/<fp>.anchor`): the anchor this installation
   * founded (its own) or one it enrolled into (another key's). When no anchor is
   * recorded yet, it derives its own — the anchor it will found on first use —
   * so a caller always reads a real anchor. A caller cannot supply it, so
   * identity comes from the local key or its recorded membership, never a typed
   * string.
   */
  get anchor(): string {
    return (
      readAnchor(this.layout, this.keyPair.fingerprint) ?? deriveAnchor(this.keyPair.fingerprint)
    );
  }

  /**
   * Recovers writer state from disk: the highest segment file gives the current
   * segment and its size; the last checkpoint gives the last checkpointed seq
   * and hash; the END of the tail gives the head hash, the next seq, and the
   * events still to be signed.
   *
   * The order is load-bearing:
   *   1. HEAL FIRST. A crash mid-append can leave a partial line with no newline
   *      at the end of the last segment. Truncating it before anything parses
   *      means the reader below sees a file that ends in a newline, so a torn
   *      fragment that happens to PARSE cannot become the head — a head that
   *      the very next step would delete from disk, leaving the next append
   *      chained to a hash no reader can find. (Readers that do not heal — the
   *      verifier, the replay — still tolerate the fragment on read.)
   *   2. CHECKPOINTS BEFORE THE TAIL. How far back the tail must be read is
   *      decided by the coverage: everything above the last checkpointed seq.
   *   3. THE TIP. One read of the END of the tail answers both remaining
   *      questions — the last entry is the head, and the entries above the
   *      coverage are the events the next checkpoint owes a signature.
   *
   * Every one of those reads enters its file from the END and stops at what it
   * came for, so none of them grows with the tail. That matters because the
   * product opens a writer per write: a read here that scaled with the history
   * would make a run of N writes cost O(N²), which is the shape this recovery
   * was rebuilt to remove.
   */
  private recover(): void {
    const segments = orderedSegments(this.layout, this.tailId);
    const lastSegment = segments.at(-1);
    if (lastSegment !== undefined) {
      const match = /(\d+)\.jsonl$/.exec(lastSegment);
      this.segment = match ? Number.parseInt(match[1] as string, 10) : 1;
      // Truncates back to the end of the last COMPLETE line, so the next append
      // continues a clean tail instead of landing after the fragment — which
      // would turn a once-benign torn line into a mid-file malformed line that
      // every later read throws on. A complete append always ends in a newline,
      // so this only ever removes a genuine crash fragment.
      this.segmentBytes = healTornTail(lastSegment);
    }
    const lastCp = lastTailCheckpoint(this.layout, this.tailId);
    if (lastCp !== undefined) {
      this.lastCheckpointedSeq = lastCp.toSeq;
      this.lastCheckpointHash = checkpointHash(lastCp);
    }
    const tip = readTailTip(this.layout, this.tailId, this.upcasters, this.lastCheckpointedSeq);
    const last = tip.at(-1);
    if (last !== undefined) {
      this.head = last.link.hash;
      this.nextSeq = last.link.seq + 1;
    }
    // The tip reads whole segments, so it can reach below the coverage; the
    // buffer is only what the next checkpoint must cover.
    this.pending = tip
      .filter((entry) => entry.link.seq > this.lastCheckpointedSeq)
      .map((entry) => entry.event);
  }

  /**
   * Whether this installation has recorded the anchor it serves — the founding
   * (its own) or an enrollment into another. The core founds a fresh
   * installation before its first fact so its events resolve; this lets that
   * check be made without re-reading the tail.
   */
  get hasAnchor(): boolean {
    return readAnchor(this.layout, this.keyPair.fingerprint) !== null;
  }

  /**
   * Records the anchor this installation serves, locally and uncommitted. Called
   * by the founding/enrollment operation once, so a later `anchor` read returns
   * the recorded value rather than the derived default.
   */
  recordAnchor(anchor: string): void {
    writeAnchor(this.layout, this.keyPair.fingerprint, anchor);
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
    // Buffered only after the line reached the file: an append that threw must
    // not leave behind an event that a later checkpoint would sign and no reader
    // could ever find.
    this.pending.push(entry.event);

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
    // Same rule as the single append: buffered only after the write landed.
    for (const entry of entries) this.pending.push(entry.event);

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
   *
   * The events signed come from the writer's own buffer, never from a re-read of
   * the tail. The buffer is asserted against the range first: a checkpoint claims
   * `[fromSeq..toSeq]`, so signing a content root over a set that is not exactly
   * that range would be a silent break of the proof — a verifier recomputing the
   * root from the bytes would then read an honest tail as tampered. It refuses
   * loudly instead. The mismatch is not reachable by any legitimate use: the
   * buffer is appended to on every successful write and emptied only here.
   */
  checkpoint(): Checkpoint | null {
    const fromSeq = this.lastCheckpointedSeq + 1;
    const toSeq = this.nextSeq - 1;
    if (toSeq < fromSeq) return null;
    const covered = toSeq - fromSeq + 1;
    if (this.pending.length !== covered) {
      throw new Error(
        `chain: refusing to sign a checkpoint over ${this.tailId} seq ${fromSeq}..${toSeq}: ` +
          `the range covers ${covered} event(s) but ${this.pending.length} are buffered`,
      );
    }
    const checkpoint = signCheckpoint({
      tail: this.tailId,
      fromSeq,
      events: this.pending,
      prev: this.lastCheckpointHash,
      keyPair: this.keyPair,
    });
    const path = checkpointsPath(this.layout, this.tailId);
    ensureDir(path);
    appendFileSync(path, `${serializeCheckpoint(checkpoint)}\n`, 'utf-8');
    // Advanced only after the checkpoint reached the file, so a failed append
    // leaves the buffer intact and a retry signs the same range again.
    this.lastCheckpointedSeq = toSeq;
    this.lastCheckpointHash = checkpointHash(checkpoint);
    this.pending = [];
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
 * It asks the backward walk for the file's LAST line and needs nothing else: an
 * intact file answers with the empty line that a trailing newline leaves, whose
 * offset IS the file's size, and a torn one answers with the fragment, whose
 * offset is where to cut. One chunk, whatever the segment weighs — reading it
 * whole would put the segment's full size back on every single write, right
 * beside the parse this recovery no longer does.
 *
 * Works in bytes, not characters: the offset is the byte after the last `\n`, so
 * a multi-byte UTF-8 character split across the crash boundary is removed whole
 * with the rest of the fragment.
 */
function healTornTail(segmentPath: string): number {
  for (const line of linesFromEnd(segmentPath)) {
    if (line.text.length === 0) return line.start; // ends in a newline: intact
    truncateSync(segmentPath, line.start);
    return line.start;
  }
  return 0; // an empty file: nothing to heal, nothing written
}
