/**
 * WHAT EACH TAIL OF A DIRECTORY NAMES, read off the disk for a writer (FORMAT.md section 6.10):
 * the facts {@link recordToWriteUnder} decides the record a writer signs under from.
 *
 * A tail names a record by its `/2` tail proof, else by its last checkpoint when that one is
 * `/2`, and only when the signature verifies under the committed key its id names, with that
 * key's fingerprint recomputed, as both readers check it. A file that is not there, does not
 * parse or does not verify names nothing here; it is the readers' to refuse, and the writer does
 * not sign under a name it could not check.
 *
 * WHAT IT COSTS, PER WRITER: one small file and the last line of one more per tail, and an Ed25519
 * verification for each `/2` artifact. The first entries ({@link firstEntries}) are read only by
 * the genesis rule, which runs where no tail names a record yet: the first write of each
 * installation in a record written before records were named, and the first write of a new one.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';

import type { UpcasterRegistry } from '../events/upcaster.js';
import { checkpointSignatureHolds, NAMED_SCHEME } from './checkpoint.js';
import { parseEntry } from './entry.js';
import { type ChainLayout, tailFingerprint, tailProofPath } from './layout.js';
import {
  type Arrivals,
  arrivedSince,
  genesisTail,
  type RecordNaming,
  recordName,
  recordOf,
  type TheRecordRead,
  tailsReadAsOneRecord,
} from './record-name.js';
import { committedKeys, lastTailCheckpoint, listTails, orderedSegments } from './store.js';
import { NAMED_TAILPROOF_SCHEME, parseTailProof, verifyTailProof } from './tailproof.js';

/** What every tail of the directory names, by its id: `undefined` for a tail that names none. */
export function namesOfTails(layout: ChainLayout): Map<string, string | undefined> {
  const keys = committedKeys(layout);
  const named = new Map<string, string | undefined>();
  for (const tail of listTails(layout)) {
    named.set(tail, nameOfTail(layout, keys, tail));
  }
  return named;
}

/**
 * What the tails of the directories at `roots`, read together, name ({@link recordOf}): one
 * record, several, or none. Each directory's tails are checked under that directory's own keys.
 *
 * Asked where one record is kept in two places a person may join: a project's private tree from
 * before it moved into the repository, and the one there now (`@mnema/core`, `doctor --fix
 * private-tree`).
 */
export function recordNamedIn(roots: readonly string[]): RecordNaming {
  const named = new Map<string, string | undefined>();
  for (const root of roots) {
    for (const [tail, name] of namesOfTails({ root })) {
      if (name !== undefined || !named.has(tail)) named.set(tail, name);
    }
  }
  return recordOf(named);
}

/**
 * What arrived at `here` since the record at `base` ({@link arrivedSince}): the tails new since
 * it that name no record, and those that name another record than it, each directory's tails
 * checked under its own keys. `verify --since` asks it, with the base taken out of git.
 */
export function arrivalsSince(
  base: ChainLayout,
  here: ChainLayout,
  upcasters: UpcasterRegistry,
): Arrivals {
  return arrivedSince(namesOfTails(base), () => firstEntries(base, upcasters), namesOfTails(here));
}

/**
 * THE TAILS OF THE RECORD AT `layout`, beside {@link listTails}: what a reading of the record reads,
 * and, where the directory holds tails of two records or more, those records, of which it reads
 * nothing ({@link tailsReadAsOneRecord}). Each tail is named as the writer names it
 * ({@link namesOfTails}); a tail with no segment holds nothing and counts toward no name, as both
 * readers count it. A directory of one tail or none is read without asking.
 *
 * Every reading that folds the record's events asks this, not `listTails`: the projection's replay
 * and its catch-up (`@mnema/core`, `projections/order.ts`) and the console's feed, so nothing of a
 * directory of two records governs, and a surface that says what governs says why from `several`
 * (`code/tests/a-directory-of-two-records-governs-nothing.test.ts`).
 *
 * WHAT IT COSTS: nothing more than `listTails` for a directory of one tail. Else what
 * {@link namesOfTails} costs, a small file, the last checkpoint line and an Ed25519 verification
 * per tail, at each catch-up of the projection, which is each write a hook gates. The projection
 * keeps what its catch-up found (`ProjectionCache.severalRecords`), so a surface asking reads
 * nothing again. Measured on the built binary, the rules pushed at a write, median of 15, base and
 * head alternated: one tail +0 ms, 8 tails +7 ms, 32 tails +18 ms, about 0.6 ms per tail (before the
 * surfaces took the catch-up's answer it was about 1 ms: 8 tails +11 ms, 32 tails +32 ms).
 */
export function tailsReadAt(layout: ChainLayout): TheRecordRead {
  const tails = listTails(layout);
  if (tails.length < 2) return { read: tails, several: [] };
  const named = namesOfTails(layout);
  for (const tail of tails) {
    if (named.get(tail) !== undefined && orderedSegments(layout, tail).length === 0) {
      named.set(tail, undefined);
    }
  }
  return tailsReadAsOneRecord(named);
}

/**
 * The name the genesis tail of the record at `layout` derives (FORMAT.md section 6.10): the name a
 * writer from 0.1.5 on gives a record written before records were named, and the one
 * {@link arrivalsSince} holds a tail to where no tail of the base names one. Undefined where no
 * tail holds a first entry.
 */
export function nameTheGenesisDerives(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
): string | undefined {
  const genesis = genesisTail(firstEntries(layout, upcasters));
  return genesis === undefined ? undefined : recordName(genesis);
}

/** The record one tail names, as checked here, or `undefined`. */
function nameOfTail(
  layout: ChainLayout,
  keys: ReturnType<typeof committedKeys>,
  tail: string,
): string | undefined {
  const fingerprint = tailFingerprint(tail);
  const committed = keys(fingerprint);
  if (committed === null || committed.fingerprint() !== fingerprint) return undefined;
  const proof = readProof(layout, tail);
  if (
    proof?.scheme === NAMED_TAILPROOF_SCHEME &&
    verifyTailProof({ proof, tail, publicKey: committed.key }).ok
  ) {
    return proof.record;
  }
  let last: ReturnType<typeof lastTailCheckpoint>;
  try {
    last = lastTailCheckpoint(layout, tail);
  } catch {
    return undefined;
  }
  if (
    last?.scheme !== NAMED_SCHEME ||
    last.tail !== tail ||
    last.signerFp !== fingerprint ||
    !checkpointSignatureHolds(last, committed.key)
  ) {
    return undefined;
  }
  return last.record;
}

/** A tail's proof as stored, or `undefined` where there is none that parses. */
function readProof(
  layout: ChainLayout,
  tail: string,
): ReturnType<typeof parseTailProof> | undefined {
  const path = tailProofPath(layout, tail);
  if (!existsSync(path)) return undefined;
  try {
    return parseTailProof(readFileSync(path, 'utf-8').replace(/\n$/, ''));
  } catch {
    return undefined;
  }
}

/**
 * The `at` of the first entry (seq 0) of every tail that holds one, for the genesis rule
 * (`genesisTail`): the first line of each tail's first segment, read and parsed as the readers
 * parse it. A tail whose first line does not read is no genesis here.
 */
export function firstEntries(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
): { readonly tail: string; readonly at: string }[] {
  const firsts: { tail: string; at: string }[] = [];
  for (const tail of listTails(layout)) {
    const segment = orderedSegments(layout, tail)[0];
    if (segment === undefined) continue;
    const line = firstLine(segment);
    if (line === undefined) continue;
    try {
      const entry = parseEntry(line, upcasters);
      if (entry.link.seq === 0 && entry.link.tail === tail)
        firsts.push({ tail, at: entry.event.at });
    } catch {
      // Not a first entry the readers read: no genesis.
    }
  }
  return firsts;
}

/** How much of a segment is read at a time while looking for its first line's end. */
const CHUNK_BYTES = 64 * 1024;

/** The first complete line of a file, without its newline, or `undefined` for none. */
function firstLine(file: string): string | undefined {
  const fd = openSync(file, 'r');
  try {
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const chunk = Buffer.alloc(CHUNK_BYTES);
      const read = readSync(fd, chunk, 0, CHUNK_BYTES, offset);
      if (read === 0) return undefined;
      const end = chunk.subarray(0, read).indexOf(0x0a);
      if (end !== -1) {
        chunks.push(chunk.subarray(0, end));
        return Buffer.concat(chunks).toString('utf-8');
      }
      chunks.push(chunk.subarray(0, read));
      offset += read;
    }
  } finally {
    closeSync(fd);
  }
}
