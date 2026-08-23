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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { canonicalStringify } from '../events/canonical.js';
import { oneLine } from '../one-line.js';
import { headerCarriesRealWork, parseBlockHeader } from './bitcoin.js';
import { checkpointHash } from './checkpoint.js';
import type { ChainLayout } from './layout.js';
import { witnessBlocksPath, witnessDir, witnessProofPath } from './layout.js';
import type { WitnessStatus } from './level.js';
import { parseOtsProof, type ReachedAttestation, reachedAttestations } from './ots.js';
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

/** What one checkpoint's stored witness reads as. */
export interface WitnessReading {
  readonly status: WitnessStatus;
  /** Why it reads that way, in words a verdict may quote. */
  readonly detail: string;
  /** The instant attested, in seconds since the epoch — only when covered. */
  readonly at?: number;
  /** The Bitcoin block that carries it — only when covered. */
  readonly block?: number;
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

/** What the record holds for one checkpoint, or null if it holds nothing. */
export function readStoredWitness(
  layout: ChainLayout,
  tailId: string,
  checkpointHash: string,
): StoredWitness | null {
  const proofPath = witnessProofPath(layout, tailId, checkpointHash);
  if (!existsSync(proofPath)) return null;
  const headers = new Map<number, Buffer>();
  const blocksPath = witnessBlocksPath(layout, tailId, checkpointHash);
  if (existsSync(blocksPath)) {
    for (const line of readFileSync(blocksPath, 'utf-8').split('\n')) {
      if (line.trim() === '') continue;
      const stored = parseStoredHeader(line);
      if (stored !== null) headers.set(stored.height, Buffer.from(stored.header, 'hex'));
    }
  }
  return { proof: readFileSync(proofPath), headers };
}

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

/** No witness at all — the state every record is in until one is asked for. */
const NOTHING: WitnessReading = {
  status: 'not-covered',
  detail: 'nothing outside this machine attests this record',
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

  let anchored: WitnessReading | null = null;
  let waiting: WitnessReading | null = null;
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
 * The chain's witness: the WEAKEST of its tails, over the checkpoint each one ends
 * at.
 *
 * Weakest for the reason the level's own fold is weakest (`weakerLevel`): a record
 * is several tails and a reader is given one answer, so an attestation over one
 * machine's tail must never speak for the machine beside it whose events nobody
 * witnessed. And it is the LAST checkpoint of each tail that is asked about,
 * because an attestation over an earlier one dates what came before it and says
 * nothing about what came after — the same residual `fullySigned` reports one layer
 * down.
 *
 * A tail with no verified checkpoint is `not-covered` and does not need special
 * handling: a chain with any such tail cannot be `fully-signed` either, so the top
 * rung was already out of reach before this was asked.
 */
export function witnessOfChain(
  layout: ChainLayout,
  through: ReadonlyMap<string, string | null>,
): ChainWitness {
  const tails: TailWitness[] = [];
  for (const [tail, checkpoint] of through) {
    tails.push({
      tail,
      checkpoint,
      reading:
        checkpoint === null
          ? {
              status: 'not-covered',
              detail: 'no checkpoint of this tail passed its signature check',
            }
          : readWitness(layout, tail, checkpoint),
    });
  }
  const weakest = tails.reduce<WitnessReading | null>(
    (worst, t) =>
      worst === null || WITNESS_RANK[t.reading.status] < WITNESS_RANK[worst.status]
        ? t.reading
        : worst,
    null,
  );
  const reading = weakest ?? NOTHING;
  return { status: reading.status, detail: reading.detail, tails };
}
