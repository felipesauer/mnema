/**
 * T3, the layer outside this machine: what the record stores, and what a reader
 * offline can conclude from it.
 *
 * THE HOLE THIS CLOSES is the one the other two layers cannot. T1 catches an edit
 * that breaks the hash chain; T2/T4 catches an edit made without the signing key.
 * Neither catches the party who HOLDS the key, rebuilds the whole chain from
 * nothing and re-signs it: every hash links, every signature checks, and the
 * verdict is green over a record that was written this morning and claims a year.
 * What that party cannot do is produce an attestation dated before they started.
 * So the witness attests one thing and one thing only — that a checkpoint's signed
 * message EXISTED at an instant — and a chain rebuilt today has no checkpoint whose
 * digest anybody attested yesterday.
 *
 * WHAT LEAVES THE MACHINE IS A DIGEST AND NOTHING ELSE. The subject is
 * `checkpointHash` — the SHA-256 of a checkpoint's signed message — so no id, no
 * title, no body and no count travels. And ONE checkpoint is enough for the whole
 * run of them: checkpoints chain (`prev` is the hash of the previous one's signed
 * message, FORMAT.md §6), so an attestation over the last one dates every
 * checkpoint below it. This is why the layer is cheap enough to be honest about —
 * it is not an attestation per event, nor even per checkpoint.
 *
 * AND THEY ACCUMULATE. Nothing here removes a witness file, so stamping today and
 * writing tomorrow leaves yesterday's proof under yesterday's digest, still proving
 * what it proved. The reading therefore asks the NEWEST checkpoint it holds a
 * confirmed attestation for and reports how far that reaches — see
 * {@link witnessOfTail}, which is where the premise that only the last checkpoint is
 * worth asking about was found to be false and what replaced it.
 *
 * WHAT IS STORED, beside the checkpoints it is about:
 *
 *   tails/<tailId>/witness/<checkpointHash>.ots      the detached proof
 *   tails/<tailId>/witness/<checkpointHash>.blocks   the 80-byte block headers
 *
 * The `.ots` is the ECOSYSTEM'S OWN FILE, unaltered: a stranger with the
 * `opentimestamps` client and no copy of this product runs `ots verify` on it and
 * gets the same answer. The `.blocks` sidecar is this package's, and it is what
 * makes the reading offline — a proof ends at "the merkle root of block N", and
 * without N's header that sentence is a claim rather than arithmetic. Both commit
 * with the tree: they are public by construction (a digest, a merkle path, a block
 * header) and a clone that could not check T3 would be a clone the layer does not
 * reach.
 *
 * THREE STATES AND THE MIDDLE ONE IS THE POINT. An attestation is ASYNCHRONOUS —
 * the calendars aggregate, a Bitcoin block takes as long as it takes — so between
 * asking and confirming there is a real, ordinary state that is neither absence nor
 * coverage. Calling it coverage would be the whole layer reduced to a promise; see
 * {@link WITNESS_COVERS} in level.ts, which is where `pending` has to declare that
 * it counts for nothing.
 *
 * NOTHING HERE REACHES THE NETWORK. This module is the STORE — it reads and writes
 * the two files, and it is where both the verifier and the act that stamps go for
 * them, so neither can come to a private idea of where a witness lives or of what
 * one says. Speaking to a calendar is witness-request.ts, which `verify` does not
 * import and never will: a verifier that phoned anyone would be a verifier whose
 * answer depended on somebody else being up.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import { canonicalStringify } from '../events/canonical.js';
import { oneLine } from '../one-line.js';
import { headerCarriesRealWork, parseBlockHeader } from './bitcoin.js';
import { checkpointHash } from './checkpoint.js';
import type { ChainLayout } from './layout.js';
import { witnessBlocksPath, witnessDir, witnessProofPath } from './layout.js';
import type { WitnessStatus } from './level.js';
import {
  MAX_PROOF_BYTES,
  parseOtsProof,
  type ReachedAttestation,
  reachedAttestations,
} from './ots.js';
import { lastTailCheckpoint } from './store.js';

/**
 * The strength order of the three states — the fold over several tails reads it,
 * and it is TOTAL over {@link WitnessStatus} so a fourth state does not compile
 * until it says where it sits between absence and coverage.
 */
const WITNESS_RANK: Readonly<Record<WitnessStatus, number>> = {
  'not-covered': 0,
  pending: 1,
  covered: 2,
};

/**
 * What one checkpoint's stored witness reads as.
 *
 * IT IS A UNION ON THE STATUS, so `covered` is the only shape that carries an
 * instant. It used to be one interface with two optional numbers, and the two were
 * optional for a true reason — a reading that is not covered has no instant to
 * report — stated in a way the compiler could not act on: a caller that wanted the
 * instant of a covered reading had to assert it or branch on a case that cannot
 * happen, and this package has already measured what an `as` costs (it empties the
 * assertion that quotes it). Split, the instant is present exactly where it exists.
 */
export type WitnessReading = AttestedReading | UnattestedReading;

/** A reading that reached a confirmed attestation — the only one with an instant. */
export interface AttestedReading {
  readonly status: 'covered';
  /** Why it reads that way, in words a verdict may quote. */
  readonly detail: string;
  /** The instant attested, in seconds since the epoch. */
  readonly at: number;
  /** The Bitcoin block that carries it. */
  readonly block: number;
}

/**
 * A reading that did not reach one: an absence, a refusal, or a request still open.
 *
 * The status is written as an EXCLUSION rather than as two spelled-out members, so a
 * fourth {@link WitnessStatus} lands here by construction instead of falling outside
 * both halves of the union and taking the compiler's word for it with them.
 */
export interface UnattestedReading {
  readonly status: Exclude<WitnessStatus, 'covered'>;
  /** Why it reads that way, in words a verdict may quote. */
  readonly detail: string;
  /**
   * True when the record holds NO witness file for this checkpoint at all — as
   * opposed to holding one this machine refuses.
   *
   * The two are different sentences and only one of them can go stale. An absence
   * says nothing attests the record, which stops being true the moment an OLDER
   * checkpoint is attested; a refusal is a finding about one file and stays true
   * beside any dating. {@link witnessOfTail} is the only reader, and it is what
   * decides which of those two sentences a tail gets.
   */
  readonly absent?: true;
  /**
   * An attestation over an EARLIER checkpoint, when this one has none to give.
   *
   * Set only by {@link witnessOfTail}, never by {@link readWitness}: one checkpoint's
   * stored files cannot know what an older checkpoint's say. It is not coverage and
   * never becomes any — see {@link DatedThrough}.
   */
  readonly datedThrough?: DatedThrough;
}

/**
 * How far back a record is provably dated when its HEAD is not the dated point.
 *
 * THREE NUMBERS AND THEY ONLY MEAN ANYTHING TOGETHER. "Dated since 23 August" without
 * saying how much of the record is dated is the same half-truth the product used to
 * tell in the other direction, and a count of undated events without an instant is a
 * complaint rather than a fact. So the reading carries the instant, the block that
 * carries it, and how many events were written after the checkpoint it dates.
 *
 * IT IS NOT COVERAGE and it is deliberately not reachable from one. It hangs off
 * {@link UnattestedReading} alone, so no fold, no level and no exit code can arrive
 * at it from a state that counts — the mistake this layer already made once, when a
 * requested-and-unconfirmed attestation looked enough like coverage to be counted as
 * some.
 */
export interface DatedThrough {
  /** The instant attested, in seconds since the epoch. */
  readonly at: number;
  /** The Bitcoin block that carries it. */
  readonly block: number;
  /** How many events were written after the checkpoint that attestation dates. */
  readonly after: number;
}

/** One block header the record carries, by the height it is claimed for. */
interface StoredHeader {
  readonly height: number;
  readonly header: string;
}

/**
 * The witness stored for one checkpoint — the two files, read but not judged.
 *
 * Kept apart from {@link readWitness} because the ACT that requests an attestation
 * needs exactly this and none of the ruling: it asks what is already there so it
 * does not stamp the same checkpoint twice.
 */
export interface StoredWitness {
  readonly proof: Buffer;
  readonly headers: ReadonlyMap<number, Buffer>;
}

/**
 * What the record holds for one checkpoint, or null if it holds nothing.
 *
 * THE SIZE IS ASKED BEFORE THE BYTES ARE, and the order is the point. Both files are
 * COMMITTED, so a clone reads whatever the last person to write the repository put
 * there — and a reader that loads whatever it is handed and checks the size afterwards
 * has already allocated it. `parseOtsProof` refuses a proof past its limit, which is
 * the right refusal at the wrong moment: by then a gigabyte is in memory. Refused here
 * instead, by the same number, so nothing oversized is ever read.
 */
export function readStoredWitness(
  layout: ChainLayout,
  tailId: string,
  checkpointHash: string,
): StoredWitness | null {
  const proofPath = witnessProofPath(layout, tailId, checkpointHash);
  if (!existsSync(proofPath)) return null;
  if (statSync(proofPath).size > MAX_PROOF_BYTES) return { proof: OVERSIZED, headers: new Map() };
  const headers = new Map<number, Buffer>();
  const blocksPath = witnessBlocksPath(layout, tailId, checkpointHash);
  // The sidecar is one line per block a proof reaches, and a proof is capped, so a file
  // past this holds lines no attestation will ever ask for.
  if (existsSync(blocksPath) && statSync(blocksPath).size <= MAX_BLOCKS_BYTES) {
    for (const line of readFileSync(blocksPath, 'utf-8').split('\n')) {
      if (line.trim() === '') continue;
      const stored = parseStoredHeader(line);
      if (stored !== null) headers.set(stored.height, Buffer.from(stored.header, 'hex'));
    }
  }
  return { proof: readFileSync(proofPath), headers };
}

/**
 * What stands in for a proof too big to read: bytes that are not one, so the reading
 * takes the refusal every unreadable proof takes and says the same thing.
 *
 * A shape rather than a `null`, because `null` here means "nothing was ever asked for",
 * which is a different fact and reads as a different sentence.
 */
const OVERSIZED = Buffer.from('oversized');

/**
 * How many bytes of block headers this reads. A proof is capped at
 * {@link MAX_PROOF_BYTES} and reaches at most one attestation per few bytes of it, so
 * this is far more sidecar than any capped proof can ask for.
 */
const MAX_BLOCKS_BYTES = 1 << 16;

/**
 * A stored header line, or null if it is not one.
 *
 * A line this cannot read is DROPPED rather than thrown out of, and the reason is
 * what the reading does with the absence: a missing header leaves the attestation
 * `pending` — the honest "an anchor exists and this record cannot check it here" —
 * whereas an exception would take down a verdict about the chain over a sidecar
 * that is not part of the chain at all.
 */
function parseStoredHeader(line: string): StoredHeader | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { height, header } = parsed as Partial<StoredHeader>;
    if (typeof height !== 'number' || !Number.isInteger(height)) return null;
    if (typeof header !== 'string' || !/^[0-9a-f]{160}$/.test(header)) return null;
    return { height, header };
  } catch {
    return null;
  }
}

/** How one stored header is written — one line, the canonical form of the tree. */
export function serializeStoredHeader(height: number, header: Buffer): string {
  return canonicalStringify({ header: header.toString('hex'), height });
}

/**
 * Stores a witness over one checkpoint — the proof, and the headers it needs.
 *
 * IT OVERWRITES, and that is what the naming is for. A proof is born incomplete and
 * is REPLACED as it completes, so the same checkpoint has to land on the same path
 * every time; an append-only log of one checkpoint's successive proofs would leave
 * every reader deciding which line is the current one, which is a second opinion
 * about a question with one answer.
 *
 * The headers file is written only when there are headers, so a stamp that has not
 * confirmed leaves no empty sidecar for a reader to wonder about.
 */
export function writeWitness(
  layout: ChainLayout,
  tailId: string,
  checkpointHash: string,
  witness: { readonly proof: Buffer; readonly headers?: ReadonlyMap<number, Buffer> },
): void {
  mkdirSync(witnessDir(layout, tailId), { recursive: true });
  writeFileSync(witnessProofPath(layout, tailId, checkpointHash), witness.proof);
  const headers = [...(witness.headers ?? new Map<number, Buffer>())].sort((a, b) => a[0] - b[0]);
  if (headers.length === 0) return;
  // Each line carries its own terminator rather than being joined by one, so the file
  // ends in a newline like every other line-per-record file this package writes — and
  // so this write holds no template that reads like a SENTENCE with a break in it.
  const lines = headers.map(([height, header]) => `${serializeStoredHeader(height, header)}\n`);
  writeFileSync(witnessBlocksPath(layout, tailId, checkpointHash), lines.join(''), 'utf-8');
}

/**
 * No witness at all — the state every record is in until one is asked for.
 *
 * ITS WORDS ARE A CLAIM ABOUT THE WHOLE RECORD, which is why it is marked
 * {@link UnattestedReading.absent}. Every other `not-covered` reading is a finding
 * about the one file it read; this one speaks for everything, and it is the only
 * sentence here that a fact elsewhere in the tree can falsify. See
 * {@link witnessOfTail}, which is where an older attestation takes it away.
 */
const NOTHING: UnattestedReading = {
  status: 'not-covered',
  detail: 'nothing outside this machine attests this record',
  absent: true,
};

/**
 * What the record's stored witness for one checkpoint proves, read offline.
 *
 * The order of the answers is the safety of this function, exactly as it is in
 * `provenLevel`: a stored header that CONTRADICTS its attestation is decided
 * before any question of coverage, so a record carrying one can never be read as
 * covered by whichever other calendar path happened to be fine. A contradiction is
 * somebody's file saying a block attests a root the block does not carry, and the
 * only honest thing to do with it is to refuse the whole reading.
 *
 * A proof over the WRONG DIGEST is the same kind of refusal one step earlier: an
 * attestation for some other checkpoint, filed under this one's name, witnesses
 * nothing here however impeccable it is on its own terms.
 */
export function readWitness(
  layout: ChainLayout,
  tailId: string,
  checkpointHash: string,
): WitnessReading {
  const stored = readStoredWitness(layout, tailId, checkpointHash);
  if (stored === null) return NOTHING;
  // THE PARSE *AND* THE WALK, under one guard. The walk applies the path's operations,
  // and one of them can be unavailable rather than wrong — OpenSSL 3 moved `ripemd160`
  // behind its legacy provider, so a node built without it cannot run that step. Left
  // outside this, that throw would take down a verdict about a CHAIN over a file that is
  // not part of the chain. Both halves answer the same way now: a proof this machine
  // cannot read attests nothing here, and says which.
  let proof: ReturnType<typeof parseOtsProof>;
  let reached: readonly ReachedAttestation[];
  try {
    proof = parseOtsProof(stored.proof);
    reached = reachedAttestations(proof);
  } catch (error) {
    return {
      status: 'not-covered',
      detail: `the stored proof is unreadable: ${oneLine(String((error as Error).message))}`,
    };
  }
  if (proof.digest.toString('hex') !== checkpointHash) {
    return {
      status: 'not-covered',
      detail: 'the stored proof is over another digest, so it attests nothing here',
    };
  }

  let anchored: AttestedReading | null = null;
  let waiting: UnattestedReading | null = null;
  for (const { attestation, message } of reached) {
    if (attestation.kind === 'pending') {
      waiting ??= {
        status: 'pending',
        detail: `an attestation was requested from ${oneLine(attestation.uri)} and has not confirmed`,
      };
      continue;
    }
    if (attestation.kind !== 'bitcoin') continue;
    const bytes = stored.headers.get(attestation.height);
    if (bytes === undefined) {
      waiting ??= {
        status: 'pending',
        detail: `anchored in Bitcoin block ${attestation.height}, whose header this record does not carry`,
      };
      continue;
    }
    const header = parseBlockHeader(bytes);
    if (!headerCarriesRealWork(header)) {
      return {
        status: 'not-covered',
        detail: `the stored header for Bitcoin block ${attestation.height} carries no proof of work`,
      };
    }
    if (!header.merkleRoot.equals(message)) {
      return {
        status: 'not-covered',
        detail: `the stored header for Bitcoin block ${attestation.height} carries another merkle root`,
      };
    }
    anchored ??= {
      status: 'covered',
      detail: `Bitcoin block ${attestation.height} at ${new Date(header.time * 1000).toISOString()}`,
      at: header.time,
      block: attestation.height,
    };
  }
  return (
    anchored ??
    waiting ?? { status: 'not-covered', detail: 'the stored proof reaches no attestation' }
  );
}

/**
 * The checkpoint a witness is FILED UNDER for a tail: the last one it stored.
 *
 * ONE ANSWER FOR TWO CALLERS, which is the only reason it is a function. The act
 * that stamps and the reading that lists both have to name the same checkpoint, or
 * an attestation lands at a path nothing looks at. The verifier is the third caller
 * and deliberately does NOT use this: it names the checkpoint it PROVED, because a
 * verifier that trusted the last stored line would be reading a file it has not
 * judged. The two agree exactly when the tail verifies — which is the state the
 * stamping act refuses to proceed without, and `chain.test.ts` is where that
 * agreement is asserted rather than assumed.
 */
export function checkpointToWitness(layout: ChainLayout, tailId: string): string | null {
  const last = lastTailCheckpoint(layout, tailId);
  return last === undefined ? null : checkpointHash(last);
}

/**
 * One checkpoint a reading may ask about, and how far into the tail it reaches.
 *
 * THE `toSeq` TRAVELS WITH THE DIGEST because the question this layer owes an answer
 * to is not "is the head attested" but HOW MUCH of the record an attestation dates,
 * and that is a seq. A digest on its own says which checkpoint was attested and
 * nothing whatever about extent, which is the half of the answer the product used to
 * leave out.
 */
export interface ProvenCheckpoint {
  /** The digest of the checkpoint's signed message — what an attestation is filed under. */
  readonly hash: string;
  /** The last event seq this checkpoint covers. */
  readonly toSeq: number;
}

/** One tail, as much of it as the witness reading needs. */
export interface WitnessedTail {
  /**
   * The checkpoints the CALLER stands behind, in the order they cover the events —
   * empty when there are none.
   *
   * Which ones those are is the caller's to say, and the two callers say different
   * things on purpose: the verifier passes the checkpoints that VERIFIED, because a
   * verdict may not rest on a line it has not judged, and `mnema witness` passes the
   * ones the tail STORED, because a listing has never claimed to have verified
   * anything. Neither reading of "a checkpoint" belongs to this function.
   */
  readonly checkpoints: readonly ProvenCheckpoint[];
  /** How many events the tail holds — what the undated remainder is counted against. */
  readonly events: number;
}

/** What {@link witnessProofPath} names a proof with — the one place the suffix is known. */
const PROOF_SUFFIX = '.ots';

/**
 * The checkpoint digests this tail holds a proof for — the directory, read once.
 *
 * IT IS AN OPTIMIZATION AND NOT A SECOND OPINION. {@link readWitness} stays the only
 * thing that decides what a stored witness SAYS; this decides only which checkpoints
 * are worth asking it about, and it can skip one exactly when that checkpoint's
 * `.ots` is not on the disk — the same fact {@link readStoredWitness} establishes one
 * `existsSync` at a time. It exists for the walk: without it, a tail with a thousand
 * checkpoints and one attestation costs a thousand `existsSync` calls to find it, and
 * with it costs one `readdir`. Both were measured; the numbers are in this delivery's
 * report, and `witness.test.ts` pins the agreement rather than assuming it.
 */
function stampedCheckpoints(layout: ChainLayout, tailId: string): ReadonlySet<string> {
  const dir = witnessDir(layout, tailId);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(PROOF_SUFFIX))
      .map((name) => name.slice(0, -PROOF_SUFFIX.length)),
  );
}

/**
 * What one tail's stored witnesses prove about it: where its head stands, and — when
 * the head is not the dated point — how far back an OLDER attestation still reaches.
 *
 * THE PREMISE THIS FALSIFIES was written one function down and read: *it is the LAST
 * checkpoint of each tail that is asked about, because an attestation over an earlier
 * one dates what came before it and says nothing about what came after.* The second
 * half is true, and is the whole reason the third world below exists. The first half
 * does not follow from it: an attestation over an earlier checkpoint says nothing
 * about what came AFTER, and goes on saying everything about what came BEFORE. So a
 * record with an attestation in its tree began answering `nothing outside this
 * machine attests this record` the instant somebody wrote one more event — a sentence
 * that is false about that record, and an understatement of what it can prove.
 *
 * THREE WORLDS, WHERE THE PRODUCT HAD TWO:
 *
 *   - nothing attests this tail — {@link NOTHING}, unchanged to the byte;
 *   - the record is dated TO ITS HEAD: the newest attested checkpoint covers the last
 *     event there is. The only state that reads as coverage;
 *   - the record is dated TO A POINT, and events were written after it. The new one.
 *     It is an {@link UnattestedReading} by construction, and its sentence says how
 *     many events fall outside the dating in the same breath as it gives the date,
 *     because a date without a boundary is the half-truth this delivery removes.
 *
 * WHICH QUESTION THE SENTENCE ANSWERS, decided and written down: **how far into the
 * record the dating reaches, and when that point was dated** — the NEWEST attested
 * checkpoint, never the oldest. Two reasons and a cost. The verdict's other clauses
 * are all about extent (`N event(s) above the last checkpoint …`), so a T3 clause on
 * that axis composes into one sentence instead of two a reader has to reconcile; and
 * the layer exists to defeat a chain rebuilt this morning, which the LARGEST provably
 * old prefix defeats hardest. The other question — *since when is the old part
 * dated*, the EARLIEST attestation — names a date whose boundary is a different and
 * smaller prefix, so an honest clause would have to carry two (checkpoint, date)
 * pairs and would answer neither. It costs more, too: this walk stops at the first
 * attestation it meets coming down from the head, and the earliest one can only be
 * had by reading every proof the tail stores.
 *
 * Returns null when the caller offered no checkpoint at all: there is no reading to
 * give, and the sentence for that is the caller's, because the two callers mean
 * different things by an empty list.
 */
export function witnessOfTail(
  layout: ChainLayout,
  tailId: string,
  tail: WitnessedTail,
): WitnessReading | null {
  const head = tail.checkpoints[tail.checkpoints.length - 1];
  if (head === undefined) return null;
  const stamped = stampedCheckpoints(layout, tailId);
  const atHead = stamped.has(head.hash) ? readWitness(layout, tailId, head.hash) : NOTHING;
  const lastSeq = tail.events - 1;
  // Dated to its head — the state that reads as coverage, and the only one that does.
  // The head CHECKPOINT being attested is not enough: events written above it are
  // outside the dating exactly as events above the last checkpoint are outside the
  // signature, and a clause that said `covered` over those was claiming a reach it
  // did not have.
  if (atHead.status === 'covered' && head.toSeq >= lastSeq) return atHead;
  for (let i = tail.checkpoints.length - 1; i >= 0; i -= 1) {
    const checkpoint = tail.checkpoints[i] as ProvenCheckpoint;
    if (!stamped.has(checkpoint.hash)) continue;
    const reading =
      i === tail.checkpoints.length - 1 ? atHead : readWitness(layout, tailId, checkpoint.hash);
    if (reading.status !== 'covered') continue;
    const after = lastSeq - checkpoint.toSeq;
    return {
      status: atHead.status === 'covered' ? 'not-covered' : atHead.status,
      detail: datedDetail(atHead, reading, after),
      datedThrough: { at: reading.at, block: reading.block, after },
    };
  }
  return atHead;
}

/**
 * How a tail dated to a POINT reads: the date, what it reaches, and what the head's
 * own file said if that was a finding.
 *
 * THE ABSENCE IS REPLACED, A FINDING IS KEPT. `nothing outside this machine attests
 * this record` is false about a record holding a proof and is the defect itself, so
 * it goes. A refusal about the head's own file — an unreadable proof, a header nobody
 * mined — is a finding that stays true beside any dating, and replacing it would turn
 * a fix for an understatement into a hidden forgery signal. So only the marked
 * absence gives way.
 *
 * IT IS A FUNCTION AND NOT A TEMPLATE AT THE `detail:` because of what walks this
 * package: `the-phrase-the-domain-words-is-one-line.test.ts` follows a producer into
 * its body, and a sentence assembled in a local `const` beside the property is a
 * sentence that walk never enters. Written as one, both templates are sites and every
 * value in them is classified.
 */
function datedDetail(atHead: WitnessReading, attested: AttestedReading, after: number): string {
  const dating = `the last attested checkpoint is dated by ${attested.detail}, with ${after} event(s) written after it`;
  return atHead.status === 'covered' || atHead.absent === true
    ? dating
    : `${atHead.detail}, and ${dating}`;
}

/** What one tail's witness stands at, and over which checkpoint. */
export interface TailWitness {
  readonly tail: string;
  /** The checkpoint the witness is about, or null if the tail has none to witness. */
  readonly checkpoint: string | null;
  readonly reading: WitnessReading;
}

/** What the whole chain's witness stands at. */
export interface ChainWitness {
  readonly status: WitnessStatus;
  readonly detail: string;
  readonly tails: readonly TailWitness[];
}

/**
 * How much a reading CLAIMS, as a tuple compared left to right — the chain's fold
 * keeps the SMALLEST, so the sentence it publishes is one no tail contradicts.
 *
 * THE SECOND NUMBER IS THIS DELIVERY'S, and without it the delivery would have moved
 * the falsehood rather than removed it. The fold used to keep whichever `not-covered`
 * tail came first, which was harmless while every `not-covered` said the same thing.
 * It is not harmless now: one tail can carry a DATING and the one beside it none, and
 * publishing the dating for the chain would be the same overstatement in the other
 * direction. A reading that claims a dating is STRONGER than one that claims nothing
 * at the same status, and loses.
 *
 * THE THIRD IS THE INSTANT, LATER FIRST. A date further from today is a stronger
 * claim about how far back the record provably reaches, so the weaker of two dated
 * tails is the one dated most recently. Within each group the number is defined for
 * every member — `covered` always carries an instant, a dating always carries one,
 * and nothing else has one at all — so it never compares a fact against a filler.
 *
 * THE FOURTH IS THE REMAINDER, AND IT WAS FOUND BY A PROBE rather than reasoned
 * about. Two tails dated by the SAME block, one a single event past its dating and
 * one thirty-eight past, tied on the first three numbers — and the tie fell to
 * whichever came first, so the chain published *with 1 event(s) written after it*
 * about a record holding thirty-nine undated events. Weakest means weakest on this
 * axis too, so the larger remainder wins and the published count is a floor no tail
 * falls below.
 *
 * WHAT IT STILL DOES NOT DO, said out loud: the instant and the remainder can name
 * DIFFERENT tails, and this takes the instant first, because the instant is what the
 * layer proves and the remainder is what qualifies it. The per-tail truth is in
 * {@link ChainWitness.tails}, and the record's whole undated residual is the verdict's
 * coverage clause, which is summed across tails.
 */
function claimOf(reading: WitnessReading): readonly [number, number, number, number] {
  const dating = reading.status === 'covered' ? undefined : reading.datedThrough;
  return [
    WITNESS_RANK[reading.status],
    dating === undefined ? 0 : 1,
    reading.status === 'covered' ? -reading.at : -(dating?.at ?? 0),
    -(dating?.after ?? 0),
  ];
}

/** Whether `a` claims strictly less than `b` — a tie keeps whoever is already held. */
function claimsLess(a: WitnessReading, b: WitnessReading): boolean {
  const mine = claimOf(a);
  const theirs = claimOf(b);
  for (let i = 0; i < mine.length; i += 1) {
    const left = mine[i] as number;
    const right = theirs[i] as number;
    if (left !== right) return left < right;
  }
  return false;
}

/** Whether a reading says an attestation exists at all — coverage, or a dating. */
function isDated(reading: WitnessReading): boolean {
  return reading.status === 'covered' || reading.datedThrough !== undefined;
}

/** Whether a reading is the ABSENCE — no stored witness at all, rather than a refusal. */
function isAbsence(reading: WitnessReading): boolean {
  return reading.status !== 'covered' && reading.absent === true;
}

/**
 * What a tail with nothing the VERIFIER proved reads as.
 *
 * It is the verifier's sentence and not {@link witnessOfTail}'s, because the two
 * callers mean different things by an empty list: here it means no checkpoint passed
 * its signature check, and in `mnema witness` it means the tail sealed none at all.
 * One sentence for both would have to be vague enough to be true of either.
 */
const NO_VERIFIED_CHECKPOINT: UnattestedReading = {
  status: 'not-covered',
  detail: 'no checkpoint of this tail passed its signature check',
};

/**
 * The chain's witness: the WEAKEST of its tails, over the checkpoints each one
 * carries.
 *
 * Weakest for the reason the level's own fold is weakest (`weakerLevel`): a record is
 * several tails and a reader is given one answer, so an attestation over one
 * machine's tail must never speak for the machine beside it whose events nobody
 * witnessed. What is asked of each tail is {@link witnessOfTail} — no longer its last
 * checkpoint alone, for the reason written there.
 *
 * A tail with no verified checkpoint is `not-covered` and does not need special
 * handling: a chain with any such tail cannot be `fully-signed` either, so the top
 * rung was already out of reach before this was asked.
 */
export function witnessOfChain(
  layout: ChainLayout,
  proven: ReadonlyMap<string, WitnessedTail>,
): ChainWitness {
  const tails: TailWitness[] = [];
  for (const [tail, offered] of proven) {
    tails.push({
      tail,
      checkpoint: offered.checkpoints[offered.checkpoints.length - 1]?.hash ?? null,
      reading: witnessOfTail(layout, tail, offered) ?? NO_VERIFIED_CHECKPOINT,
    });
  }
  const weakest = tails.reduce<TailWitness | null>(
    (worst, t) => (worst === null || claimsLess(t.reading, worst.reading) ? t : worst),
    null,
  );
  const reading = weakest?.reading ?? NOTHING;
  return {
    status: reading.status,
    // THE ABSENCE CANNOT SPEAK FOR A CHAIN THAT HOLDS AN ATTESTATION. `nothing outside
    // this machine attests this record` is a claim about everything, and with two
    // tails it can be published for a chain where the other one IS dated — the same
    // false sentence this delivery exists to remove, one level up. When some tail is
    // dated, the weakest tail's absence is worded as the absence it actually is.
    detail:
      weakest !== null && isAbsence(reading) && tails.some((t) => isDated(t.reading))
        ? `tail ${oneLine(weakest.tail)} holds no attestation`
        : reading.detail,
    tails,
  };
}
