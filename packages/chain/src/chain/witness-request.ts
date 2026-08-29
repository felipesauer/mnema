/**
 * The two acts that need the network: asking for an attestation, and completing it.
 *
 * THEY ARE HERE AND NOT IN verify.ts, AND THAT SEPARATION IS THE DESIGN. A verifier
 * that reached the network would be a verifier whose answer depended on somebody
 * else being up, and the whole claim of this product is that a clone with no
 * connection can re-derive the verdict. So verification reads files (witness.ts) and
 * this module — which nothing on the verifying path imports — is the only thing that
 * speaks to anyone.
 *
 * NOTHING ON THE WRITING PATH IMPORTS IT EITHER, and that is the second half of the
 * same decision. Sealing a checkpoint does not ask for an attestation: a write that
 * could fail because a calendar was unreachable would be a record that stops
 * recording when the wifi drops, and the honest reading of a chain nobody could stamp
 * is `not-covered`, which the verdict already says. Stamping is a separate act
 * somebody performs, and a record that is never stamped behaves byte for byte as it
 * did before this layer existed.
 *
 * WHAT TRAVELS is a 32-byte digest of a checkpoint's signed message, with 16 random
 * bytes appended per calendar so that two calendars are not handed the same value.
 * No id, no title, no body, no count, and no way back: the calendars see a hash of a
 * hash.
 *
 * ASYNCHRONY IS NOT AN INCONVENIENCE HERE, IT IS THE MECHANISM. A calendar answers
 * immediately with a promise; the promise becomes a proof when a Bitcoin block
 * carries the aggregate root, which is minutes to hours later. {@link stampCheckpoint}
 * is the ask, {@link completeWitness} is the return visit, and between them the record
 * reads `pending` — a real state with a name, never a green.
 */

import { randomBytes } from 'node:crypto';

import { BLOCK_HEADER_BYTES } from './bitcoin.js';
import {
  applyOtsOp,
  type OtsProof,
  type OtsTimestamp,
  parseOtsProof,
  parseOtsTimestamp,
  reachedAttestations,
  serializeOtsProof,
  sha256,
} from './ots.js';

/**
 * The calendars a stamp is asked of by default — the public aggregators the
 * OpenTimestamps client ships with.
 *
 * SEVERAL, AND THE REASON IS THE ONLY TRUST THIS SCHEME HAS LEFT. A calendar cannot
 * forge a timestamp — the proof it returns either folds into a real block or it does
 * not — but it CAN simply never answer, and a proof asked of one server that goes
 * away is a proof that never completes. Asking four means any one of them is enough,
 * and a record whose stamp completed through one has no dependency on the other
 * three ever existing again.
 */
export const DEFAULT_CALENDARS: readonly string[] = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.btc.calendar.opentimestamps.org',
  'https://btc.calendar.catallaxy.com',
];

/**
 * Where a block header is fetched from while completing an attestation.
 *
 * IT IS A DEPENDENCY OF THE ACT AND NOT OF THE PROOF, and the difference is the
 * whole point of storing the header. This service is asked once, when an attestation
 * completes; after that the 80 bytes are in the record and every verification for
 * the rest of the record's life is arithmetic. A reader who does not trust this
 * particular server checks the block id against any other — the header hashes to it,
 * so a substituted header is not a matter of trust but of a hash that does not match.
 */
export const DEFAULT_BLOCK_SOURCE = 'https://blockstream.info/api';

/** How this module reaches the network — injected so a test drives it without one. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What a calendar or a block source refused, named rather than thrown. */
export interface WitnessRefusal {
  readonly where: string;
  readonly reason: string;
}

/** The bytes of a proof, and what would not answer while it was made. */
export interface StampedWitness {
  readonly proof: Buffer;
  readonly refusals: readonly WitnessRefusal[];
}

/**
 * What the RETURN VISIT asks through — a block source, and the fetcher behind both acts.
 *
 * IT HAS NO CALENDARS, AND THE ABSENCE IS THE TYPE DOING THE ARGUING. A return visit
 * does not pick who to ask: {@link upgradeNode} walks the proof's own pending
 * attestations and each one carries the URI of the calendar that took it, so the
 * address is the record's rather than the caller's. While the two acts shared one
 * shape, a caller could hand this one a list of calendars and the compiler had nothing
 * to say — and one did. `mnema witness upgrade --calendar` was a public option whose
 * value was carried through three layers into this parameter and read by nothing, while
 * its help said `the calendars to ask, when the defaults are not the ones used`; there
 * are no defaults on this path, because there is no choice on this path. The option is
 * gone and the shape is split, so writing one here does not compile.
 */
export interface WitnessReturnVisit {
  readonly blockSource?: string;
  readonly fetch?: Fetcher;
}

/**
 * What the calendars and the block source are asked through — the ASK's shape.
 *
 * It is the return visit's plus the one thing only {@link stampCheckpoint} has to
 * decide: which calendars are handed a digest nobody holds yet.
 */
export interface WitnessNetwork extends WitnessReturnVisit {
  readonly calendars?: readonly string[];
}

const OTS_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/vnd.opentimestamps.v1',
  'Content-Type': 'application/x-www-form-urlencoded',
};

/**
 * Asks every calendar to attest one checkpoint digest, and returns the proof.
 *
 * The nonce is per calendar and it is NOT decoration: without it every calendar
 * would be handed the identical value, which makes the same record trivially
 * linkable across all of them and lets any one of them recognise a digest another
 * has already seen. With it, each sees `sha256(digest || 16 random bytes)` and
 * knows nothing about the others'.
 *
 * A calendar that refuses is NAMED and skipped rather than failing the act: the
 * point of asking four is that one is enough. If none answers, the proof would
 * attest nothing, so the act refuses instead of writing a file that says it
 * requested something it did not.
 */
export async function stampCheckpoint(
  checkpointHash: string,
  network: WitnessNetwork = {},
): Promise<StampedWitness> {
  const calendars = network.calendars ?? DEFAULT_CALENDARS;
  const call = network.fetch ?? fetch;
  const digest = Buffer.from(checkpointHash, 'hex');
  if (digest.length !== 32) throw new Error(`witness: ${checkpointHash} is not a sha256 digest`);
  const steps: OtsTimestamp['steps'][number][] = [];
  const refusals: WitnessRefusal[] = [];
  for (const calendar of calendars) {
    const nonce = randomBytes(16);
    const commitment = sha256(Buffer.concat([digest, nonce]));
    try {
      const response = await call(`${calendar}/digest`, {
        method: 'POST',
        // The 32 raw bytes, handed over as a view the fetch body type accepts —
        // a Buffer IS one, and naming it so costs nothing and copies nothing.
        body: new Uint8Array(commitment),
        headers: OTS_HEADERS,
      });
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      // The calendar answers with a timestamp over the commitment it was handed, so
      // the path from the digest to it is ours: append the nonce, hash, then theirs.
      steps.push({
        op: 'append',
        arg: nonce,
        next: { attestations: [], steps: [{ op: 'sha256', next: parseOtsTimestamp(body) }] },
      });
    } catch (error) {
      refusals.push({ where: calendar, reason: (error as Error).message });
    }
  }
  if (steps.length === 0) {
    throw new Error(
      `witness: no calendar answered (${refusals.map((r) => `${r.where}: ${r.reason}`).join('; ')})`,
    );
  }
  return { proof: serializeOtsProof(digest, { attestations: [], steps }), refusals };
}

/** A proof after a return visit: its bytes, the headers it now needs, what refused. */
export interface CompletedWitness {
  readonly proof: Buffer;
  /** The block headers the proof's Bitcoin attestations land in, by height. */
  readonly headers: ReadonlyMap<number, Buffer>;
  readonly refusals: readonly WitnessRefusal[];
  /** Whether a Bitcoin attestation is now reachable with a header to check it. */
  readonly complete: boolean;
}

/**
 * The return visit: asks each calendar whether its promise has become a block, and
 * fetches the headers the result needs.
 *
 * Idempotent and safe to repeat — a calendar that still has nothing answers 404 and
 * the proof comes back as it went in. A proof that is already anchored still has its
 * headers checked for, because the two halves complete separately: the block can be
 * mined long before anybody asked this record for its header.
 */
export async function completeWitness(
  proofBytes: Buffer,
  network: WitnessReturnVisit = {},
): Promise<CompletedWitness> {
  const call = network.fetch ?? fetch;
  const refusals: WitnessRefusal[] = [];
  const proof = parseOtsProof(proofBytes);
  const upgraded = await upgradeNode(proof.timestamp, proof.digest, call, refusals);
  const after: OtsProof = { ...proof, timestamp: upgraded };
  const headers = new Map<number, Buffer>();
  for (const { attestation } of reachedAttestations(after)) {
    if (attestation.kind !== 'bitcoin' || headers.has(attestation.height)) continue;
    const header = await blockHeader(attestation.height, network, call, refusals);
    if (header !== null) headers.set(attestation.height, header);
  }
  return {
    proof: serializeOtsProof(after.digest, upgraded),
    headers,
    refusals,
    complete: headers.size > 0,
  };
}

/**
 * One node's return visit, folded down the tree.
 *
 * The calendar is asked about the message THIS node stands at, which is the
 * commitment it was originally handed — so the answer splices in exactly where the
 * promise was. The promise itself is KEPT beside the answer rather than replaced:
 * dropping it would rewrite somebody's file to say the request was never made, and
 * the format carries both without contradiction.
 */
async function upgradeNode(
  node: OtsTimestamp,
  message: Buffer,
  call: Fetcher,
  refusals: WitnessRefusal[],
): Promise<OtsTimestamp> {
  const steps: OtsTimestamp['steps'][number][] = [];
  for (const step of node.steps) {
    const { next, ...op } = step;
    const applied = await upgradeNode(next, applyOtsOp(op, message), call, refusals);
    steps.push({ ...op, next: applied } as OtsTimestamp['steps'][number]);
  }
  const attestations = [...node.attestations];
  for (const attestation of node.attestations) {
    if (attestation.kind !== 'pending') continue;
    // A PROMISE THAT WAS ALREADY KEPT IS NOT ASKED AGAIN, and this line is the whole
    // of the act's idempotence. Without it a second visit splices the calendar's
    // answer in beside the copy from the first, and the stored file grows by a path
    // every time anybody runs the verb — measured here as a proof that went from
    // four attestations to six on the second pass over the same bytes.
    if (reachesBitcoin({ attestations, steps })) continue;
    const answer = await askCalendar(attestation.uri, message, call, refusals);
    if (answer === null) continue;
    steps.push(...answer.steps);
    attestations.push(...answer.attestations);
  }
  return { attestations, steps };
}

/** Whether a node already reaches a block — i.e. whether its promise was kept. */
function reachesBitcoin(node: OtsTimestamp): boolean {
  return (
    node.attestations.some((a) => a.kind === 'bitcoin') ||
    node.steps.some((step) => reachesBitcoin(step.next))
  );
}

/** Asks one calendar what became of a commitment; null when it still has nothing. */
async function askCalendar(
  uri: string,
  message: Buffer,
  call: Fetcher,
  refusals: WitnessRefusal[],
): Promise<OtsTimestamp | null> {
  try {
    const response = await call(`${uri}/timestamp/${message.toString('hex')}`, {
      headers: { Accept: OTS_HEADERS.Accept as string },
    });
    // Not yet aggregated into a block is the ORDINARY answer, not a refusal: it is
    // what every proof gets for its first hour or so of life.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`answered ${response.status}`);
    return parseOtsTimestamp(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    refusals.push({ where: uri, reason: (error as Error).message });
    return null;
  }
}

/** Fetches one block's 80-byte header, or names what would not answer. */
async function blockHeader(
  height: number,
  network: WitnessReturnVisit,
  call: Fetcher,
  refusals: WitnessRefusal[],
): Promise<Buffer | null> {
  const base = network.blockSource ?? DEFAULT_BLOCK_SOURCE;
  try {
    const at = await call(`${base}/block-height/${height}`);
    if (!at.ok) throw new Error(`answered ${at.status}`);
    const id = (await at.text()).trim();
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('did not answer with a block id');
    const raw = await call(`${base}/block/${id}/header`);
    if (!raw.ok) throw new Error(`answered ${raw.status}`);
    const header = Buffer.from((await raw.text()).trim(), 'hex');
    if (header.length !== BLOCK_HEADER_BYTES) throw new Error('did not answer with a header');
    return header;
  } catch (error) {
    refusals.push({ where: `${base} (block ${height})`, reason: (error as Error).message });
    return null;
  }
}
