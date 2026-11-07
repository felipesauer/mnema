/**
 * WHAT A WRITER OF A RELINK READS BEFORE IT WRITES (FORMAT.md section 6.11, ADR-155): which tails
 * it may relink, into which record, what each brings, and whether the readers would count the
 * relinks once written. A relink is append-only once written, so everything that refuses one is
 * asked here, over the disk, and a refusal writes nothing.
 *
 * Two questions, asked in this order by `mnema tail relink` and by `mnema doctor --fix
 * private-tree` (`@mnema/core`, `relink-operations.ts`):
 *
 * 1. {@link planRelinks}: the refusals that need no event built, each naming what it found: a tail
 *    that is not here, that names no record, that already names the record it would join, that
 *    does not verify alone, that hosts a relink or is the tail of one already; and the record it
 *    joins, the one other name of the directory unless the caller names it;
 * 2. {@link relinksWouldCount}: the readers' own rule (`relinkedNaming`, through
 *    `relinksReadAt`), over the directory as it would read with the relinks appended and covered.
 *    A relink the rule refuses is refused here by the rule's own words, and nothing is written.
 *    Then their identity check over that same directory (`identityRefusedOnlyTogether`): a relink
 *    the rule counts can still leave a record `verify` refuses, where each tree enrolled the same
 *    agent key (found on the binary, `mnema doctor --fix private-tree` exiting 0 and `verify`
 *    then failing), and that is refused too, `RELINK_WOULD_NOT_VERIFY`.
 *
 * The tails are read from `layouts`, in order: the tree the relinks are written in first, and for
 * the doctor the tree that moves into it, so the directory read is the one after the move.
 */

import type { UpcasterRegistry } from '../events/upcaster.js';
import { oneLine } from '../one-line.js';
import { type ChainEntry, readEntries } from './entry.js';
import { type ChainLayout, tailFingerprint } from './layout.js';
import { RELINK_NOT_A_MEMBER, recordName, recordOf } from './record-name.js';
import { lastTailCheckpoint, listTails, readTail } from './store.js';
import { namesOfTails } from './tail-names.js';
import {
  identityRefusedOnlyTogether,
  type RelinkToWrite,
  relinksReadAt,
  verifyChain,
} from './verify.js';

/** The identity facts a relinked tail may bring into the record it joins. */
const IDENTITY_KINDS = [
  'identity.founded',
  'key.enrolled',
  'agent.enrolled',
  'checker.enrolled',
] as const;

/** What a relinked tail brings into the record it joins: said, never refused. */
export interface RelinkBrings {
  /** How many of each identity fact it holds, for the kinds it holds any of. */
  readonly identity: readonly { readonly kind: string; readonly count: number }[];
  /** How many decisions it recorded. */
  readonly decisions: number;
  /** Its first `at`, where it is older than the first entry of the record's genesis tail. */
  readonly olderThanTheGenesis?: { readonly firstAt: string; readonly genesisAt: string };
}

/** One relink a writer is to write: everything its event says, and what the tail brings. */
export interface PlannedRelink {
  readonly tail: string;
  readonly from: string;
  readonly into: string;
  readonly throughHash: string;
  readonly eventCount: number;
  /** The anchor the tail spoke for: the `who` of its last event, the relink's subject. */
  readonly subject: string;
  readonly brings: RelinkBrings;
}

/** Why a relink is not written: a code a surface reports, and the words that name what was found. */
export interface RelinkRefusal {
  readonly ok: false;
  readonly code:
    | 'UNKNOWN_TAIL'
    | 'TAIL_NAMES_NO_RECORD'
    | 'NO_RECORD_TO_JOIN'
    | 'INTO_REQUIRED'
    | 'NO_TAIL_NAMES_INTO'
    | 'ALREADY_IN_THAT_RECORD'
    | 'TAIL_DOES_NOT_VERIFY'
    | 'TAIL_HOSTS_A_RELINK'
    | 'TAIL_ALREADY_RELINKED'
    | 'RELINK_WOULD_NOT_COUNT'
    | 'RELINK_WOULD_NOT_VERIFY';
  readonly message: string;
}

/** Every tail of `layouts`, read once, from the first layout that holds it. */
function readAll(
  layouts: readonly ChainLayout[],
  upcasters: UpcasterRegistry,
): {
  readonly entries: ReadonlyMap<string, readonly ChainEntry[]>;
  readonly named: ReadonlyMap<string, string | undefined>;
  readonly where: ReadonlyMap<string, ChainLayout>;
} {
  const entries = new Map<string, readonly ChainEntry[]>();
  const named = new Map<string, string | undefined>();
  const where = new Map<string, ChainLayout>();
  for (const layout of layouts) {
    const names = namesOfTails(layout);
    for (const tail of listTails(layout)) {
      if (where.has(tail)) continue;
      where.set(tail, layout);
      named.set(tail, names.get(tail));
      entries.set(tail, readTail(layout, tail, upcasters).entries);
    }
  }
  return { entries, named, where };
}

/**
 * The relinks of `tails` into `into` (or into the one other record the directory names), read off
 * `layouts`, or the first refusal met, tail by tail in the order given.
 */
export function planRelinks(
  layouts: readonly ChainLayout[],
  upcasters: UpcasterRegistry,
  asked: { readonly tails: readonly string[]; readonly into?: string },
): { readonly ok: true; readonly relinks: readonly PlannedRelink[] } | RelinkRefusal {
  const { entries, named, where } = readAll(layouts, upcasters);
  // The tails some relink on disk already names, and the tails that hold one.
  const relinkedOnDisk = new Map<string, string>();
  for (const [host, held] of entries) {
    for (const entry of readEntries(held)) {
      if (entry.event.kind !== 'tail.relinked') continue;
      relinkedOnDisk.set(entry.event.payload.tail, `${host}#${entry.link.seq}`);
    }
  }
  const asking = new Set(asked.tails);
  const verified = new Map<string, ReturnType<typeof verifyChain>>();
  const relinks: PlannedRelink[] = [];
  for (const tail of asked.tails) {
    const held = entries.get(tail) ?? [];
    const last = held.at(-1);
    const first = held[0];
    if (last === undefined || first === undefined) {
      return {
        ok: false,
        code: 'UNKNOWN_TAIL',
        message:
          `Tail ${oneLine(tail)} holds no events here: a relink names a tail on disk, whole, ` +
          'and binds every entry it holds (`mnema tail list` spells the ids).',
      };
    }
    const from = named.get(tail);
    if (from === undefined) {
      return {
        ok: false,
        code: 'TAIL_NAMES_NO_RECORD',
        message:
          `Tail ${oneLine(tail)} names no record (it was written before records were named, and ` +
          'no checkpoint of the second scheme binds it): `mnema verify` reads it as a census ' +
          'note already, and there is nothing to move.',
      };
    }
    // The records the directory's other tails name by their own artifacts, the tails being
    // relinked and the tails a relink names left out: the ones a relink could join.
    const others = new Map<string, string[]>();
    for (const [other, name] of named) {
      if (name === undefined || name === from || asking.has(other) || relinkedOnDisk.has(other)) {
        continue;
      }
      const group = others.get(name);
      if (group === undefined) others.set(name, [other]);
      else group.push(other);
    }
    let into = asked.into;
    if (into === undefined) {
      const names = [...others.keys()];
      if (names.length === 0) {
        return {
          ok: false,
          code: 'NO_RECORD_TO_JOIN',
          message:
            `Tail ${oneLine(tail)} names record ${oneLine(from.slice(0, 12))}..., and no other tail here names another ` +
            'record: a relink joins a tail to a record a tail of the directory already names.',
        };
      }
      if (names.length > 1) {
        return {
          ok: false,
          code: 'INTO_REQUIRED',
          message:
            `The tails here name ${names.length + 1} records (${oneLine([from, ...names].map((name) => name.slice(0, 12)).join('..., '))}...): ` +
            'say which one tail ' +
            `${oneLine(tail)} joins, with --into <record> (the record's name as \`mnema verify\` prints it, whole).`,
        };
      }
      into = names[0] as string;
    }
    // A name as `verify` prints it is its first twelve characters: taken for the whole name it
    // begins, among the names the directory holds.
    const ask = into;
    const whole =
      [...new Set(named.values())].find(
        (name) =>
          name !== undefined && (name === ask || (ask.length >= 12 && name.startsWith(ask))),
      ) ?? ask;
    if (whole === from) {
      return {
        ok: false,
        code: 'ALREADY_IN_THAT_RECORD',
        message:
          `Tail ${oneLine(tail)} already names record ${oneLine(whole.slice(0, 12))}...: a relink moves a tail between two ` +
          'records, and one into the record it names would only freeze it (relink-into-its-own-record).',
      };
    }
    if (!others.has(whole)) {
      return {
        ok: false,
        code: 'NO_TAIL_NAMES_INTO',
        message:
          `No tail here names record ${oneLine(ask)} by its own artifacts, other than a tail a relink ` +
          'names: a relink joins a tail to a record the directory holds, and one into a name no ' +
          'tail holds would be a rename, not a join.',
      };
    }
    into = whole;
    const layout = where.get(tail) as ChainLayout;
    let verdict = verified.get(layout.root);
    if (verdict === undefined) {
      verdict = verifyChain(layout, upcasters);
      verified.set(layout.root, verdict);
    }
    const broken = verdict.issues.find((issue) => issue.tail === tail);
    if (broken !== undefined) {
      return {
        ok: false,
        code: 'TAIL_DOES_NOT_VERIFY',
        message:
          `Tail ${oneLine(tail)} does not verify: ${oneLine(broken.detail)}. A relink binds every ` +
          'entry of the tail, so it would bind a broken history: nothing was written.',
      };
    }
    if (held.some((entry) => entry.event.kind === 'tail.relinked')) {
      return {
        ok: false,
        code: 'TAIL_HOSTS_A_RELINK',
        message:
          `Tail ${oneLine(tail)} holds a relink of another tail: a relink counts only from a tail ` +
          'that names its record by its own artifacts, so relinking this one would undo it ' +
          '(relink-hosted-by-a-relinked-tail).',
      };
    }
    const already = relinkedOnDisk.get(tail);
    if (already !== undefined) {
      return {
        ok: false,
        code: 'TAIL_ALREADY_RELINKED',
        message:
          `Tail ${oneLine(tail)} is named by the relink at ${oneLine(already)} already: a tail is ` +
          'relinked once, and a second relink of it counts for neither (relink-conflict). If that ' +
          'relink is not covered yet, a checkpoint of its tail by its writer covers it.',
      };
    }
    relinks.push({
      tail,
      from,
      into,
      throughHash: last.link.hash,
      eventCount: held.length,
      subject: last.event.who,
      brings: bringsOf(held, into, entries),
    });
  }
  return { ok: true, relinks };
}

/** What the entries of a tail bring into the record `into` names, beside its genesis. */
function bringsOf(
  held: readonly ChainEntry[],
  into: string,
  entries: ReadonlyMap<string, readonly ChainEntry[]>,
): RelinkBrings {
  const identity = IDENTITY_KINDS.map((kind) => ({
    kind,
    count: held.filter((entry) => entry.event.kind === kind).length,
  })).filter((one) => one.count > 0);
  const decisions = held.filter((entry) => entry.event.kind === 'decision.recorded').length;
  const firstAt = (held[0] as ChainEntry).event.at;
  const genesis = [...entries].find(([tail]) => recordName(tail) === into)?.[1][0]?.event.at;
  return genesis !== undefined && firstAt < genesis
    ? { identity, decisions, olderThanTheGenesis: { firstAt, genesisAt: genesis } }
    : { identity, decisions };
}

/** The records a directory would still hold after the relinks, beside the one they join. */
export interface LeftBehind {
  readonly record: string;
  readonly tails: readonly string[];
  /** The keys those tails' ids name: whose owners must act, or whose tails are cut. */
  readonly keys: readonly string[];
}

/**
 * Whether the readers would count `asked` once written and covered, over the tails of `layouts`
 * read together (`relinksReadAt`, the rule both readers apply): the records the directory would
 * still name beside the one joined, or the readers' refusal of the first relink they would not
 * count, in their own words. A relink whose host does not name the record it joins is read as
 * written in a new tail of its key (`newTailOf`), which is where its writer writes it. Where the
 * relinks count, it also refuses `RELINK_WOULD_NOT_VERIFY` when the readers' identity check would
 * refuse, over that directory, an event it refuses in none of `layouts` read alone
 * (`identityRefusedOnlyTogether`, `verify.ts`; `relink-plan.test.ts`, `whether the record a relink
 * leaves would verify`).
 */
export function relinksWouldCount(
  layouts: readonly ChainLayout[],
  upcasters: UpcasterRegistry,
  asked: readonly RelinkToWrite[],
  newTailOf: (fingerprint: string) => string,
):
  | { readonly ok: true; readonly leftBehind: readonly LeftBehind[] }
  | (RelinkRefusal & { readonly token?: string }) {
  const { named } = readAll(layouts, upcasters);
  // A host that does not name the record joined by its own artifacts is not written in: the
  // writer opens a new tail of the same key, born naming it (`WriterOptions.joins`).
  const toWrite = asked.map((one) =>
    named.get(one.host) === one.hostNames
      ? one
      : { ...one, host: newTailOf(tailFingerprint(one.host)) },
  );
  // A new tail is not written yet: the readers' words about its events must not name an id no
  // directory holds (`where`, `record-name.ts`).
  const notWritten = new Set(toWrite.filter((one) => !named.has(one.host)).map((one) => one.host));
  const unplaced = (
    refusal: RelinkRefusal & { readonly token?: string },
  ): RelinkRefusal & { readonly token?: string } => ({
    ...refusal,
    message: [...notWritten].reduce(
      (text, host) =>
        text.replaceAll(
          new RegExp(['tail', host, 'seq \\d+'].join(' '), 'g'),
          'a new tail of that key',
        ),
      refusal.message,
    ),
  });
  const read = relinksReadAt(layouts, upcasters, named, toWrite);
  for (const { host, event } of toWrite) {
    if (event.kind !== 'tail.relinked') continue;
    const tail = event.payload.tail;
    const refused = read.refused.find(
      (one) => one.relink.tail === tail && one.relink.host === host,
    );
    if (refused !== undefined) {
      const rule =
        refused.token === RELINK_NOT_A_MEMBER
          ? ' Only a key the record joined took in may relink into it: the key that founded the identity of its genesis tail, or a key that identity, or a member it took in, enrolled (ADR-157). A key that founded its own identity there does not count, and an admission of another person’s tail by a member of the record does not exist in this version: that person writes again in this record, under a tail born in it, or the tail is cut (`mnema tail prune`).'
          : '';
      return unplaced({
        ok: false,
        code: 'RELINK_WOULD_NOT_COUNT',
        token: refused.token,
        message: `The readers would not count the relink of tail ${oneLine(tail)}: ${refused.detail}.${rule} Nothing was written.`,
      });
    }
    if (!read.counted.some((one) => one.relink.tail === tail && one.relink.host === host)) {
      return {
        ok: false,
        code: 'RELINK_WOULD_NOT_COUNT',
        message: `The readers would not count the relink of tail ${oneLine(tail)}. Nothing was written.`,
      };
    }
  }
  // The relinks count; the record they leave must still verify where its tails did.
  const together = identityRefusedOnlyTogether(layouts, upcasters, toWrite);
  const first = together[0];
  if (first !== undefined) {
    return unplaced({
      ok: false,
      code: 'RELINK_WOULD_NOT_VERIFY',
      message:
        `The record would not verify with these relinks written: the readers' identity check ` +
        `(T2/T4, the one \`mnema verify\` makes) would refuse ${together.length} event(s) it ` +
        `refuses nowhere today, once these tails are read as one record, the first at tail ` +
        `${oneLine(first.tail)} seq ${first.seq}: ${oneLine(first.detail)}. A relink does not ` +
        'change what a tail holds: leave these tails where they are, where they verify. Nothing ' +
        'was written.',
    });
  }
  const joined = new Set(
    toWrite.flatMap((one) => (one.event.kind === 'tail.relinked' ? [one.event.payload.into] : [])),
  );
  const record = recordOf(read.named);
  const leftBehind =
    record.state === 'several'
      ? record.groups
          .filter((group) => !joined.has(group.name))
          .map((group) => ({
            record: group.name,
            tails: group.tails,
            keys: [...new Set(group.tails.map(tailFingerprint))],
          }))
      : [];
  return { ok: true, leftBehind };
}

/**
 * The tails a cut of `host` would turn back into the record they came from: each tail a relink in
 * `host` names, where `host`'s last checkpoint covers that relink (one above it counts for
 * nothing, so cutting it undoes nothing), the tail is still on disk with events in it, and no
 * waiver in the tree, covered by its own tail's last checkpoint, authorizes its cut too. `tail prune` refuses the cut of such a host
 * (`code/tests/the-owner-relinks-a-tail.test.ts`).
 */
export function tailsACutWouldUnrelink(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  host: string,
): readonly string[] {
  const covered = lastTailCheckpoint(layout, host)?.toSeq ?? -1;
  const tails = new Map(
    listTails(layout).map((tail) => [tail, readTail(layout, tail, upcasters).entries] as const),
  );
  // A waiver counts as the same cut only where its own tail's last checkpoint covers it, as a
  // relink counts only covered: one above it rests on the hash chain alone.
  const waived = new Set<string>();
  for (const [id, entries] of tails) {
    const signed = lastTailCheckpoint(layout, id)?.toSeq ?? -1;
    for (const entry of readEntries(entries)) {
      if (entry.event.kind === 'tail.pruned' && entry.link.seq <= signed) {
        waived.add(entry.event.payload.tail);
      }
    }
  }
  const undone: string[] = [];
  for (const entry of readEntries(tails.get(host) ?? [])) {
    if (entry.event.kind !== 'tail.relinked' || entry.link.seq > covered) continue;
    const tail = entry.event.payload.tail;
    if ((tails.get(tail) ?? []).length > 0 && !waived.has(tail)) undone.push(tail);
  }
  return undone;
}
