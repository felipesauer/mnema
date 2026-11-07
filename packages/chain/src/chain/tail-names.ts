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

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import { catalogUpcasters } from '../events/registry.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { checkpointSignatureHolds, NAMED_SCHEME } from './checkpoint.js';
import { parseEntry } from './entry.js';
import { type ChainLayout, keysDir, tailDir, tailFingerprint, tailProofPath } from './layout.js';
import {
  type Arrivals,
  arrivedSince,
  genesisTail,
  type RecordNaming,
  type RelinkCounted,
  recordName,
  recordOf,
  type TheRecordRead,
  tailsReadAsOneRecord,
} from './record-name.js';
import { committedKeys, lastTailCheckpoint, listTails, orderedSegments } from './store.js';
import { NAMED_TAILPROOF_SCHEME, parseTailProof, verifyTailProof } from './tailproof.js';
import { relinksReadAt } from './verify.js';

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
 * {@link namesOfTails}, with the name of a tail that holds no segment left out: it holds nothing
 * and counts toward no name, as both readers count it (`verify` leaves it out). What
 * {@link tailsReadAt} and {@link arrivalsSince} name by, so that `verify` and `verify --since`
 * agree on a tail that holds only its proof.
 */
function namesOfTailsThatHold(layout: ChainLayout): Map<string, string | undefined> {
  const named = namesOfTails(layout);
  for (const [tail, name] of named) {
    if (name !== undefined && orderedSegments(layout, tail).length === 0) {
      named.set(tail, undefined);
    }
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
 * checked under its own keys, and named on each side as the readers name them once the relinks
 * that count there are applied ({@link relinksNamedAt}). `verify --since` asks it, with the base
 * taken out of git whole, so a relink the base held is read from the base's own bytes.
 */
export function arrivalsSince(
  base: ChainLayout,
  here: ChainLayout,
  upcasters: UpcasterRegistry,
): Arrivals {
  const there = relinksNamedAt(base, upcasters);
  const now = relinksNamedAt(here, upcasters);
  return arrivedSince(there.named, () => firstEntries(base, upcasters), now.named, {
    base: there.counted,
    here: now.counted,
  });
}

/**
 * What each tail at `layout` names once the relinks that count are applied, and those relinks:
 * the readers' rule (`relinkedNaming`, through `relinksReadAt`), asked only where the tails name
 * two records or more by their own artifacts, the one shape a relink that counts leaves (its tail
 * names the record it leaves, its host the one it joins), as {@link tailsReadAt} asks it.
 */
function relinksNamedAt(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
): { named: ReadonlyMap<string, string | undefined>; counted: readonly RelinkCounted[] } {
  const named = namesOfTailsThatHold(layout);
  if (recordOf(named).state !== 'several') return { named, counted: [] };
  const read = relinksReadAt([layout], upcasters, named);
  return { named: read.named, counted: read.counted };
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
 * WHERE ITS TAILS WOULD NAME TWO RECORDS AND ONE OF THEM HOLDS A RELINK (FORMAT.md section 6.11),
 * the directory is named as `verify` names it: a relink that counts moves its tail into the record
 * it joins, and a surface that read nothing there would fail closed where both readers verify. The
 * rule is the readers' own (`relinkedNaming`, `record-name.ts`), asked through
 * `relinkedNamingAt` (`verify.ts`), which reads only what it needs: every event, the coverage of
 * the tails that hold a relink or name a record one joins (one signature per tail, the earlier
 * checkpoints bound through `prev`), and the identity fold of the record joined. A directory with
 * no relink line reads none of that, and the answer is kept until a file of the directory changes
 * (`second-reader-agrees-on-a-relink.test.ts`, "the namer of the surfaces").
 *
 * WHAT IT COSTS: nothing more than `listTails` for a directory of one tail. Else what
 * {@link namesOfTails} costs, a small file, the last checkpoint line and an Ed25519 verification
 * per tail, at each catch-up of the projection, which is each write a hook gates. The projection
 * keeps what its catch-up found (`ProjectionCache.severalRecords`), so a surface asking reads
 * nothing again. Measured on the built binary, the rules pushed at a write, median of 15, base and
 * head alternated: one tail +0 ms, 8 tails +7 ms, 32 tails +18 ms, about 0.6 ms per tail (before the
 * surfaces took the catch-up's answer it was about 1 ms: 8 tails +11 ms, 32 tails +32 ms). Only a
 * directory whose tails name two records pays more: the bytes of its segments, read once for a
 * relink line, and, where one is there, the reading above, once per change to the directory.
 * Measured on the built package, base and head alternated, median of 15 rounds of 5 calls: a
 * relinked directory whose joined record holds 553 events and 551 checkpoints, 0.79 ms on the base
 * (which reads nothing of it) against 24.16 ms on the head after a change, where a whole
 * `verifyChain` costs 86.02 ms (it was the namer's cost before), and 0.84 ms against 1.20 ms when
 * nothing changed since the last reading; a directory of two records with no relink, 0.57 ms
 * against 0.60 ms; one record, 0.02 against 0.01. A write changes the directory, so each catch-up
 * after a write pays the reading once.
 * The reading grows with the events of the record joined, about 0.04 ms each.
 */
export function tailsReadAt(layout: ChainLayout): TheRecordRead {
  const tails = listTails(layout);
  if (tails.length < 2) return { read: tails, several: [] };
  const named = namesOfTailsThatHold(layout);
  const reading = tailsReadAsOneRecord(named);
  if (reading.several.length === 0) return reading;
  const record = recordOf(relinkedIfHeld(layout, tails, named).named);
  return record.state === 'several'
    ? { read: [], several: record.groups }
    : { read: [...named.keys()], several: [] };
}

/** What each tail names once the relinks that count are applied, and the tails they moved. */
export interface NamesRelinked {
  readonly named: ReadonlyMap<string, string | undefined>;
  /** The tails a relink that counts moved into the record it joins: frozen at their head. */
  readonly relinked: ReadonlySet<string>;
}

/**
 * WHAT EACH TAIL AT `layout` NAMES FOR A WRITER, the relinks that count applied (FORMAT.md section
 * 6.11): {@link namesOfTails}, and, only where those names are two records and a segment holds a
 * relink line, the readers' rule over them, as {@link tailsReadAt} asks it and at its cost, kept
 * per directory until a file of it changes. The writer signs under these names
 * (`recordToWriteUnder`), so a directory `verify` reads as one record after a relink is one a
 * writer writes in, and a tail a relink moved is one the writer does not append to
 * (`code/tests/the-owner-relinks-a-tail.test.ts`).
 */
export function namesRelinkedAt(layout: ChainLayout): NamesRelinked {
  const named = namesOfTails(layout);
  if (recordOf(named).state !== 'several') return { named, relinked: new Set() };
  return relinkedIfHeld(layout, listTails(layout), named);
}

/** The relinked reading of a directory whose tails would name two records, or `named` as it is. */
function relinkedIfHeld(
  layout: ChainLayout,
  tails: readonly string[],
  named: ReadonlyMap<string, string | undefined>,
): NamesRelinked {
  if (!holdsARelink(layout, tails)) return { named, relinked: new Set() };
  const extent = extentOf(layout, tails);
  const kept = relinkedReadings.get(layout.root);
  if (kept?.extent === extent && sameNames(kept.from, named)) return kept.read;
  const relinks = relinksReadAt([layout], catalogUpcasters(), named);
  const read: NamesRelinked = {
    named: relinks.named,
    relinked: new Set(relinks.counted.map((one) => one.relink.tail)),
  };
  relinkedReadings.set(layout.root, { extent, from: named, read });
  return read;
}

/** Whether two namings name every tail alike. */
function sameNames(
  a: ReadonlyMap<string, string | undefined>,
  b: ReadonlyMap<string, string | undefined>,
): boolean {
  return a.size === b.size && [...a].every(([tail, name]) => b.has(tail) && b.get(tail) === name);
}

/**
 * The bytes a relink's stored line holds wherever it is: its kind, as the canonical form writes
 * it. A line that holds the kind in any other spelling is not canonical, and both readers refuse
 * it, so it can name nothing.
 */
const RELINK_BYTES = Buffer.from('"kind":"tail.relinked"', 'utf-8');

/**
 * The last relinked reading of each directory, by its root, with the extent it was taken over: one
 * entry per directory a process reads, replaced when any of its files changes.
 */
const relinkedReadings = new Map<
  string,
  {
    readonly extent: string;
    readonly from: ReadonlyMap<string, string | undefined>;
    readonly read: NamesRelinked;
  }
>();

/** Every file of the tails and the keys, by name, size and modification time, as one string. */
function extentOf(layout: ChainLayout, tails: readonly string[]): string {
  const said: string[] = [];
  const add = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const stat = statSync(join(dir, name));
      said.push(`${dir}/${name}:${stat.size}:${stat.mtimeMs}`);
    }
  };
  for (const tail of tails) add(tailDir(layout, tail));
  add(keysDir(layout));
  return said.join('\n');
}

/** Whether a segment of any of `tails` holds a relink's line, read as bytes. */
function holdsARelink(layout: ChainLayout, tails: readonly string[]): boolean {
  return tails.some((tail) =>
    orderedSegments(layout, tail).some((segment) => readFileSync(segment).includes(RELINK_BYTES)),
  );
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
