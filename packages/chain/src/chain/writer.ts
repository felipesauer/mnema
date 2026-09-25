/**
 * The append-only writer for one machine's tail.
 *
 * A writer owns exactly one tail: it appends events as sealed entries, chains
 * each to its predecessor, seals a segment once it passes the size cap, and signs a
 * checkpoint when the caller asks or when one act of writing has left too many
 * events unsigned.
 *
 * THE PREMISE THIS FILE HELD, AND WHAT FALSIFIED IT. It said: "Because each machine
 * writes only its own tail, there is never an in-file merge — concurrency across
 * machines is resolved by reading many tails, not by locking one file." The first
 * half is still true and the conclusion was still wrong, because the sentence
 * reasons about MACHINES and the danger is between PROCESSES. Two sessions on one
 * machine in one project share the identity, so they share the installation id, so
 * they share the tail: they are not two machines, they are two writers of one file,
 * and "each machine writes only its own tail" never said anything about them. What
 * falsified it is a measurement rather than an argument — two concurrent
 * `mnema decision` runs corrupted the chain in 15 of 20 rounds, and two MCP sessions
 * calling `record_observation` did the same, which is the plugin with two windows of
 * the host open on one project. So a tail IS locked now, for the window between
 * reading its end and appending to it; `tail-lock.ts` holds the mechanism and the
 * reasoning, and {@link ChainWriter.underTailLock} is the single door every write
 * here goes through.
 *
 * WHO DECIDES WHEN IT SIGNS. The writer holds a CEILING and nothing more (see
 * {@link DEFAULT_MAX_UNSIGNED_EVENTS}); the CADENCE belongs to the writing paths,
 * which sign what they wrote before they return. Reading `checkpoint()` as a knob
 * the writer turns on a schedule is the misreading this file corrected.
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
 * covers yet) is recovered from the END of the tail by the writer's first act, under
 * the lock, so a fresh process continues an existing tail correctly without re-reading
 * its history. (This said "on construction", which stopped being true when recovery
 * moved under the lock — see the constructor.) It is recovered AGAIN, under the lock,
 * whenever the tail's files turn out to have moved since this writer last looked —
 * which is what makes the held state safe to keep between appends instead of being
 * re-read on every one. See {@link ChainWriter.mark}.
 *
 * A writer that is opened and never appends leaves nothing a clone receives: the tail
 * is BORN at the first append ({@link ChainWriter.ensureBorn}), not when it is opened.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { CatalogEvent } from '../events/catalog.js';
import { EventParseError, unreadableReason } from '../events/parse.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import {
  type Checkpoint,
  checkpointHash,
  serializeCheckpoint,
  signCheckpoint,
} from './checkpoint.js';
import { type Entry, sealEntry, serializeEntry } from './entry.js';
import type { WrittenEvent } from './hash.js';
import type { KeyPair } from './keys.js';
import { materializePublicKey, signerOf, writeAnchor } from './keystore.js';
import {
  type ChainLayout,
  checkpointsPath,
  segmentPath,
  tailDir,
  tailLockPath,
  tailProofPath,
} from './layout.js';
import { linesFromEnd } from './lines.js';
import { lastTailCheckpoint, orderedSegments, readTailTip } from './store.js';
import { withTailLock } from './tail-lock.js';
import { serializeTailProof, signTailProof } from './tailproof.js';
import { unprovenWaiverReason } from './waiver.js';

/** Seal a segment once it grows past this many bytes (segments rotate by size). */
export const DEFAULT_MAX_SEGMENT_BYTES = 4 * 1024 * 1024;

/**
 * The most events one act of writing may leave unsigned before the writer signs on
 * its own. A CEILING, not the cadence — the sibling of {@link
 * DEFAULT_MAX_SEGMENT_BYTES}, and read the same way: 4 MiB is not how big a segment
 * is, it is how big one may get.
 *
 * THE NAME USED TO BE `DEFAULT_MAX_UNSIGNED_EVENTS`, and the premise that rename
 * falsifies is written down here because it cost a whole reading of this file. That
 * name says "sign every 64 events", so the product's actual cadence — one signature
 * per act of writing, whatever its size — read as a mechanism that never fires, and it
 * was written down as DEAD CODE, "inert", in two separate places. It is not dead: it
 * fires whenever
 * ONE act writes more than this many events, and the product has such an act —
 * `mnema decision import --write` puts two events on the tail per ADR through a
 * single writer and signs once at the end, so a directory of 33 ADRs crosses it. That
 * is measured, on the real command, in `every-write-signs-what-it-wrote.test.ts`.
 *
 * So the two numbers answer different questions and neither is the other's default:
 * the CADENCE is one signature per act (kept by the writing paths, and guarded by
 * that same file); this is the most an act may leave open before the writer stops
 * waiting for it.
 */
export const DEFAULT_MAX_UNSIGNED_EVENTS = 64;

export interface WriterOptions {
  readonly maxSegmentBytes?: number;
  /** The ceiling above; see {@link DEFAULT_MAX_UNSIGNED_EVENTS}. */
  readonly maxUnsignedEvents?: number;
}

/**
 * What this writer last left the tail's files looking like — the witness it asks,
 * under the lock, before it trusts the state it is holding.
 *
 * It exists to keep ONE cost from coming back. The obvious way to be safe against
 * another process is to re-read the tail's end before every append, but this writer's
 * recovery reads every event above the last checkpoint, and the ceiling on that
 * window is a thousand in this workspace's own tests — so a per-append recovery is
 * quadratic in exactly the acts that write the most. Three `stat` calls answer the
 * only question that matters instead: did anything change since we looked? For a
 * process writing alone — which is nearly every process — the answer is always no,
 * and the recovery runs once, as it did before.
 *
 * The three are not a sample, they are the complete set of ways another writer can
 * change what this one is holding: it can grow the segment we are writing (bytes),
 * roll onto the next one (a segment we do not know about appearing), or sign a
 * checkpoint (the coverage moving under our buffer).
 *
 * THIS COMMENT ONCE ARGUED that `nextSegment` was redundant — "a roll is always
 * preceded by growth we would have seen" — and the mutation battery falsified it:
 * blinding the mark to a new segment left ZERO tests red, which is a finding and not
 * a pass, and writing the case the argument said was unreachable turned it red. The
 * growth that pushes a segment over its cap happens BEFORE this writer's mark is
 * taken, not after; so the other writer opens, sees a full segment, rolls, and writes
 * every byte of its entry somewhere this writer is not looking. The segment we are
 * watching does not move at all. The case is
 * `tail-lock.test.ts > notices the other writer rolling onto a segment this one does
 * not know about`.
 */
interface TailMark {
  /** Size of the segment this writer believes it is appending to, or -1 if absent. */
  readonly segmentBytes: number;
  /** Whether the segment AFTER it exists — somebody else rolled. */
  readonly nextSegment: boolean;
  /** Size of `checkpoints.jsonl`, or -1 if absent. */
  readonly checkpointBytes: number;
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
   *
   * It holds the WRITTEN form, and that matters most for the entries `recover()`
   * puts here: those came off the disk and were lifted on the way. A checkpoint
   * folded over the lifted reading would be a signature over bytes that are not
   * on the tail — signed by the real key, so no verifier could tell it from a
   * forgery, and every one of them would report the range as broken. The buffer
   * a running process fills is the same form, so the two paths cannot drift.
   */
  private pending: WrittenEvent[] = [];

  /**
   * The tail as this writer last left it. Compared under the lock before every act;
   * a difference means another process wrote and the held state is stale. See
   * {@link TailMark}.
   *
   * It starts as a value no real tail can produce, so the first act always recovers
   * rather than trusting a default that happens to match an empty tail.
   */
  private mark: TailMark = { segmentBytes: -2, nextSegment: false, checkpointBytes: -2 };

  /**
   * Whether this writer has already made sure its tail is born — see {@link ensureBorn}.
   * Per writer, so the three checks run once per writer rather than once per append.
   */
  private born = false;

  private readonly maxSegmentBytes: number;
  private readonly maxUnsignedEvents: number;

  private readonly tailId: string;

  constructor(
    private readonly layout: ChainLayout,
    private readonly keyPair: KeyPair,
    installationId: string,
    private readonly upcasters: UpcasterRegistry,
    options: WriterOptions = {},
  ) {
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    this.maxUnsignedEvents = options.maxUnsignedEvents ?? DEFAULT_MAX_UNSIGNED_EVENTS;
    this.tailId = `${keyPair.fingerprint}-${installationId}`;
    // NOTHING IS WRITTEN HERE. Both the recovery and the birth happen in the first act,
    // under the tail's lock.
    //
    // Recovery cannot happen here, because it TRUNCATES a torn trailing fragment, and
    // cutting a file another process is appending to is the hazard the tail lock
    // closed. So it runs under the lock, in the first act — the starting {@link mark}
    // is a value no real tail can produce, so that act always recovers.
    //
    // THIS COMMENT SAID BIRTH COULD NOT MOVE WITH IT: "taking the lock in a constructor
    // makes `openChainForWriting` block on another process's append, … so the directory
    // and the ownership proof are written here, unlocked." The reason holds against the
    // constructor and never held against the first APPEND, which already runs under the
    // lock. What moved birth there is a measurement. The surfaces open a writer before an
    // operation's own door speaks — an oversize field, a name holding a credential, a
    // move the gate refuses — so a key new to the tree that was refused left the tail's
    // directory and its proof behind (with the key's public half, see
    // `openChainForWriting`), untracked, published by the next `git add -A`, and that
    // tail with no event in it changed every `verify` of the record after it. Born in
    // {@link ensureBorn}, a writer that appends nothing leaves nothing a clone receives.
    //
    // AND THE ONE UNGUARDED RACE THIS COMMENT EXCUSED IS GONE. Two fresh processes could
    // both find the proof absent and both write it — benign only because the bytes are an
    // Ed25519 signature over the tail id, which is deterministic. Two processes of one
    // installation share the tail, hence the lock, so under it the second finds the proof
    // the first wrote.
  }

  /**
   * Gives this tail what a clone needs in order to verify it — the key's public half in the
   * chain, the tail's directory, and its proof of ownership — once, from inside the first act
   * that appends: after that act's own refusals ({@link refuseUnreadable},
   * {@link refuseUnprovenWaiver}) and before its first byte.
   *
   * It is the ONE PLACE a tail is born, and the two append doors are the only callers, which
   * is what makes "a writer that appends nothing publishes nothing" a property of this class
   * rather than of every operation that opens one — `writer.test.ts`, *a tail is born at its
   * first append, not when its writer opens*, asks it of both doors, of the writer's own
   * refusals and of a checkpoint with nothing to sign. Why here and not at open is the
   * constructor's comment.
   *
   * Idempotent, like each of the three: a tail another process already gave birth to — or one
   * this installation has been writing for years — is left exactly as it is.
   */
  private ensureBorn(): void {
    if (this.born) return;
    materializePublicKey(this.layout, this.keyPair);
    mkdirSync(tailDir(this.layout, this.tailId), { recursive: true });
    this.ensureTailProof();
    this.born = true;
  }

  /**
   * THE ONE DOOR every act that touches this tail's files goes through: it takes the
   * tail's lock, brings the held state back in line with the disk if another process
   * moved it, runs the act, and records where it left the files.
   *
   * There is one of these rather than three because the rule — "read the end and
   * append to it as one indivisible act" — is one rule, and a rule with three
   * readings is the shape that produces the divergence nobody notices. The public
   * doors ({@link append}, {@link appendAll}, {@link checkpoint}) are thin wrappers
   * that do nothing but call this; their bodies moved into `*Locked` siblings, which
   * may be called ONLY from inside it. That split is also what keeps the lock
   * non-reentrant: {@link capUnsignedWindow} signs through {@link signLocked}, never
   * through the public {@link checkpoint}, so an append that crosses the ceiling does
   * not try to take a lock it is already holding.
   *
   * The mark is written AFTER the act and only if it returned. An act that threw may
   * have left the files in a state this writer's fields do not describe, so leaving
   * the mark stale is the conservative answer: the next act sees "moved" and recovers.
   */
  private underTailLock<T>(act: () => T): T {
    // No options: the writer takes the lock's own budgets. They are not a knob this
    // class forwards, because nothing in the product would have a reason to differ
    // from them, and an option no caller sets is the defect this workspace already
    // has a name for.
    return withTailLock(tailLockPath(this.layout, this.tailId), () => {
      this.resyncIfMoved();
      const result = act();
      this.mark = this.readMark();
      return result;
    });
  }

  /**
   * Re-reads the tail's end if, and only if, its files are not where this writer left
   * them. The cheap question that keeps the expensive one rare — see {@link TailMark}.
   */
  private resyncIfMoved(): void {
    const now = this.readMark();
    if (
      now.segmentBytes === this.mark.segmentBytes &&
      now.nextSegment === this.mark.nextSegment &&
      now.checkpointBytes === this.mark.checkpointBytes
    ) {
      return;
    }
    this.recover();
  }

  private readMark(): TailMark {
    return {
      segmentBytes: sizeOf(segmentPath(this.layout, this.tailId, this.segment)),
      nextSegment: sizeOf(segmentPath(this.layout, this.tailId, this.segment + 1)) >= 0,
      checkpointBytes: sizeOf(checkpointsPath(this.layout, this.tailId)),
    };
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
   * The tail this writer owns — `<fingerprint>-<installationId>`.
   *
   * Exposed for the one rule that is about a tail's IDENTITY rather than its
   * contents: a waiver may not name the tail it is written to, and an operation
   * that wants to refuse that in words (rather than meet the writer's throw) has to
   * be able to ask which tail it is about to write to.
   */
  get tail(): string {
    return this.tailId;
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
    return signerOf(this.layout, this.keyPair.fingerprint).anchor;
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
      .map((entry) => entry.written);
  }

  /**
   * Whether this installation has recorded the anchor it serves — the founding
   * (its own) or an enrollment into another. The core founds a fresh
   * installation before its first fact so its events resolve; this lets that
   * check be made without re-reading the tail.
   */
  get hasAnchor(): boolean {
    return signerOf(this.layout, this.keyPair.fingerprint).hasAnchor;
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
   *
   * Refuses first what no reader could accept ({@link refuseUnreadable}).
   *
   * Indivisible against another process writing this tail: reading the end and
   * appending to it happen under the tail's lock ({@link underTailLock}).
   *
   * @throws {TailBusyError} if another process holds the tail past the wait budget.
   * Nothing is appended.
   */
  append(event: CatalogEvent): Entry {
    return this.underTailLock(() => this.appendLocked(event));
  }

  private appendLocked(event: CatalogEvent): Entry {
    refuseUnreadable(event);
    this.refuseUnprovenWaiver(event);
    this.ensureBorn();
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
    this.pending.push(entry.written);

    this.capUnsignedWindow();
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
   *
   * EVERY event is checked against the reader's rule before ANY is sealed
   * ({@link refuseUnreadable}), so a batch whose second event is unreadable does
   * not leave the first one on the tail — the atom holds for the refusal too.
   *
   * The lock is taken ONCE for the whole batch, not once per event, so a birth pair
   * cannot be split by another process any more than it can by a crash.
   *
   * @throws {TailBusyError} if another process holds the tail past the wait budget.
   * Nothing is appended.
   */
  appendAll(events: readonly CatalogEvent[]): Entry[] {
    if (events.length === 0) return [];
    return this.underTailLock(() => this.appendAllLocked(events));
  }

  private appendAllLocked(events: readonly CatalogEvent[]): Entry[] {
    for (const event of events) {
      refuseUnreadable(event);
      this.refuseUnprovenWaiver(event);
    }
    this.ensureBorn();
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
    for (const entry of entries) this.pending.push(entry.written);

    this.capUnsignedWindow();
    return entries;
  }

  /**
   * Refuses a waiver whose claims the disk does not bear out, BEFORE it is sealed.
   *
   * It sits beside {@link refuseUnreadable} and for the same reason — the two
   * append doors are every way onto a tail, so a check here holds for every writing
   * path there is — but it asks a question that function cannot: the rule is about
   * what is on DISK, and only the writer knows the layout and the tail it is landing
   * on. That is also why it is a method and not a free function.
   *
   * IT IS THE WRITE SIDE ONLY, deliberately. The reader's rule cannot include it:
   * a waiver outlives the tail it names, so a read applying this check would refuse
   * the waiver a moment after it became true, and one unreadable line refuses the
   * whole tail forever. See waiver.ts.
   *
   * It THROWS, on the same argument the unreadable refusal throws on: every field it
   * checks is one the writing operation read off the disk itself, so a mismatch means
   * a producer assembled a claim it did not take from the record — a bug here, not an
   * input somebody got wrong.
   */
  private refuseUnprovenWaiver(event: CatalogEvent): void {
    const reason = unprovenWaiverReason({
      layout: this.layout,
      upcasters: this.upcasters,
      event,
      ownTail: this.tailId,
    });
    if (reason === undefined) return;
    throw new EventParseError(
      `refusing to seal a waiver the record does not bear out: ${reason}. This write was not appended.`,
    );
  }

  /**
   * Holds the unsigned window under the ceiling: signs a checkpoint once one act of
   * writing has left more than {@link DEFAULT_MAX_UNSIGNED_EVENTS} events above the
   * last one. Coverage stays contiguous — each checkpoint starts at the seq right
   * after the previous one's end.
   *
   * It is NOT the product's cadence and does not set it. Every writing path signs
   * what it wrote before it returns, which is a far tighter rule than this one and is
   * guarded separately (`every-write-signs-what-it-wrote.test.ts`). What this catches
   * is the act too big to wait for: a bulk import, a session serving a long list of
   * patterns. Without it, one act could put an unbounded number of events on the tail
   * with nothing signed until the end, and a crash halfway would leave every one of
   * them resting on the hash chain alone.
   */
  private capUnsignedWindow(): void {
    const uncovered = this.nextSeq - 1 - this.lastCheckpointedSeq;
    if (uncovered < this.maxUnsignedEvents) return;
    // {@link signLocked}, never the public {@link checkpoint}: this runs from inside
    // an append that is already holding the tail's lock, and the lock does not nest.
    this.signLocked();
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
   * buffer is appended to on every successful write and emptied only here — AND the
   * coverage it reads is brought back in line with the disk under the lock first, so
   * a range another process has already signed is not signed a second time.
   *
   * @throws {TailBusyError} if another process holds the tail past the wait budget.
   * Nothing is signed.
   */
  checkpoint(): Checkpoint | null {
    return this.underTailLock(() => this.signLocked());
  }

  private signLocked(): Checkpoint | null {
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

/**
 * Refuses an event that no reader could accept, BEFORE it is sealed.
 *
 * This is the narrowest point there is. An entry reaches a tail through exactly
 * two doors — {@link ChainWriter.append} and {@link ChainWriter.appendAll} — so a
 * check here holds for every writing path that exists and every one that will be
 * added, including one written by a caller outside this workspace. The rule it
 * applies is not a rule of its own: {@link unreadableReason} IS the reader's
 * validator, so "the writer refuses exactly what the reader refuses" is a property
 * of the code and not a discipline anybody has to keep.
 *
 * It matters because the failure it closes is unrecoverable. An unreadable entry
 * on an append-only log cannot be taken back, and the replay refuses the whole
 * tail rather than the one line, so a single empty title left every later read of
 * that project — every search, every show, every timeline — failing forever while
 * the write reported success.
 *
 * It THROWS, and that is deliberate: reaching it means a producer built an event
 * its own catalog forbids, which is a bug in this codebase, not an input a person
 * got wrong. The surfaces ask {@link unreadableReason} themselves and turn the
 * same answer into a typed refusal, so an ordinary bad input is reported and
 * costs nothing; this is the floor under that, for the caller that forgot to ask.
 */
function refuseUnreadable(event: CatalogEvent): void {
  const reason = unreadableReason(event);
  if (reason === undefined) return;
  throw new EventParseError(
    `refusing to seal an event no reader could accept: ${reason}. This write was not appended.`,
  );
}

/**
 * A file's size in bytes, or -1 if it is not there.
 *
 * Absent and empty have to be TOLD APART here — a segment that does not exist yet and
 * one a recovery truncated to nothing are different states of the tail — so the
 * answer is a number a size can never be, not a zero that both would produce.
 */
function sizeOf(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return -1;
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
