/**
 * THE RECORD A TAIL BELONGS TO (FORMAT.md section 6.10).
 *
 * One person signs every record they write in with one key, and public keys travel with the
 * record, so a signature made for one record verified in any other that held the key: a tail of
 * project A, copied with its keys into project B, read as that person's acts in B. A record is
 * named so that a signature made for one does not count in another. The name is derived, never
 * drawn: the SHA-256 of a framed tag and the id of the record's genesis tail, the tail whose first
 * entry carries the smallest `at` (a tie to the smaller tail id). Two machines that never saw each
 * other derive the same name from the tail `init` wrote, which every clone holds.
 *
 * Every clone holds it until a person cuts it, which `mnema tail prune` lets them do. The name
 * does not move with that cut while one tail carries it, because a writer takes the name the other
 * tails carry before it asks the genesis rule, and the waiver the cut needs is written, before it,
 * on a tail that names the record (`code/tests/the-record-name-survives-a-cut-of-its-genesis.test.ts`).
 * A genesis removed with no tail left carrying the name, or a tail older than the genesis arriving
 * before any tail names the record, gives the next writer another genesis, and the record two
 * names that both readers refuse (the same test).
 *
 * The name lives only inside what is already signed: the tail proof and the checkpoint under
 * their second schemes (tailproof.ts, checkpoint.ts). A reader never recomputes it as an
 * authority. It asks {@link recordOf} whether the named tails of a directory agree, and names the
 * genesis tail, as information, when one of them hashes to the name. The readings that say what
 * governs ask {@link recordOf} too, and read nothing of a directory whose tails name two records
 * ({@link tailsReadAsOneRecord}); they refuse nothing, which stays the readers'.
 */

import { oneLine } from '../one-line.js';
import { type ChainEntry, readEntries } from './entry.js';
import { framedTextDigest } from './hash.js';
import { tailFingerprint } from './layout.js';

/** The domain tag of a record's name. Exported because FORMAT.md names it. */
export const RECORD_DOMAIN = 'mnema.record.v1';

/** The name of the record whose genesis tail is `genesis`: lower-case hex, like every digest. */
export function recordName(genesis: string): string {
  return framedTextDigest(RECORD_DOMAIN, genesis);
}

/**
 * The genesis tail among tails given by the `at` of their first entry (seq 0): the smallest
 * `at`, compared as text, and on a tie the smaller tail id, compared as text by UTF-16 code unit
 * (the order "Reading many tails" uses). Undefined when no tail holds a first entry.
 */
export function genesisTail(
  firsts: Iterable<{ readonly tail: string; readonly at: string }>,
): string | undefined {
  let best: { readonly tail: string; readonly at: string } | undefined;
  for (const first of firsts) {
    if (
      best === undefined ||
      first.at < best.at ||
      (first.at === best.at && first.tail < best.tail)
    ) {
      best = first;
    }
  }
  return best?.tail;
}

/** The record a directory's tails belong to, as its named tails say. */
export type RecordNaming =
  /** No tail names a record: every tail was written before records were named. */
  | { readonly state: 'unnamed' }
  /**
   * Every named tail names `name`. `genesis` is the tail of the directory that hashes to it, when
   * one does; `unnamed` the tails that name no record.
   */
  | {
      readonly state: 'named';
      readonly name: string;
      readonly genesis?: string;
      readonly unnamed: readonly string[];
    }
  /** The named tails name more than one record: each name with its tails, by name. */
  | {
      readonly state: 'several';
      readonly groups: readonly { readonly name: string; readonly tails: readonly string[] }[];
    };

/**
 * Which record the tails belong to, given what each one names (`undefined` for a tail that names
 * none). The tails are taken in the order given, and the groups are ordered by name.
 */
export function recordOf(named: ReadonlyMap<string, string | undefined>): RecordNaming {
  const groups = new Map<string, string[]>();
  const unnamed: string[] = [];
  for (const [tail, name] of named) {
    if (name === undefined) {
      unnamed.push(tail);
      continue;
    }
    const tails = groups.get(name);
    if (tails === undefined) groups.set(name, [tail]);
    else tails.push(tail);
  }
  if (groups.size === 0) return { state: 'unnamed' };
  if (groups.size > 1) {
    return {
      state: 'several',
      groups: [...groups]
        .map(([name, tails]) => ({ name, tails }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    };
  }
  const name = [...groups.keys()][0] as string;
  const genesis = [...named.keys()].find((tail) => recordName(tail) === name);
  return genesis === undefined
    ? { state: 'named', name, unnamed }
    : { state: 'named', name, genesis, unnamed };
}

/**
 * The record a writer writes under, or why it does not write: the answer of
 * {@link recordToWriteUnder}.
 *
 * - `several`: the OTHER tails already name two records or more. Writing would grow a directory
 *   both readers refuse (`another-record`), whichever name the writer chose.
 * - `foreign`: the writer's own tail names `own`, and every other named tail names `record`: to
 *   the rest of the directory its tail is the one of another record (and the rest are to it; a
 *   directory alone does not tell which came first), and growing it grows what both readers
 *   refuse.
 */
export type WriteUnder =
  | { readonly name: string }
  | {
      readonly refused: 'several';
      readonly groups: readonly { readonly name: string; readonly tails: readonly string[] }[];
    }
  | { readonly refused: 'foreign'; readonly own: string; readonly record: string };

/**
 * THE NAME A WRITER SIGNS UNDER (FORMAT.md section 6.10), from what each tail of the directory
 * names (`named`, `undefined` for a tail that names none, the writer's own `tail` among them or
 * not), in this order:
 *
 * 1. the name its own tail carries;
 * 2. else the one name the other tails carry;
 * 3. else (no tail names a record: one written before records were named, or a new one) the name
 *    of the record the directory `continues`, when it continues one (a project's private tree
 *    founded in the repository while the one from before it moved still names a record);
 * 4. else the name of the genesis tail, by the first entries `firsts` gives, asked for only here;
 *    with no tail holding a first entry, the writer's own tail is the genesis: a new record names
 *    itself.
 *
 * Refused, whatever the writer's own tail names, where the other tails name two records; and
 * where its own tail names one and the other named tails another.
 *
 * `joins`, where the writer's caller decided the record (the host of a relink, FORMAT.md section
 * 6.11, which is written to mend a directory of two records): that name, whatever the other tails
 * name, unless the writer's own tail names another, which is refused as `foreign`.
 */
export function recordToWriteUnder(
  tail: string,
  named: ReadonlyMap<string, string | undefined>,
  firsts: () => Iterable<{ readonly tail: string; readonly at: string }>,
  continues: () => string | undefined = () => undefined,
  joins?: string,
): WriteUnder {
  const own = named.get(tail);
  if (joins !== undefined) {
    return own === undefined || own === joins
      ? { name: joins }
      : { refused: 'foreign', own, record: joins };
  }
  const others = recordOf(new Map([...named].filter(([other]) => other !== tail)));
  if (others.state === 'several') return { refused: 'several', groups: others.groups };
  if (own !== undefined) {
    return others.state === 'named' && others.name !== own
      ? { refused: 'foreign', own, record: others.name }
      : { name: own };
  }
  if (others.state === 'named') return { name: others.name };
  return { name: continues() ?? recordName(genesisTail(firsts()) ?? tail) };
}

/** One record a directory holds tails of: its name, and those tails. */
export interface RecordGroup {
  readonly name: string;
  readonly tails: readonly string[];
}

/** What a reading of the record reads in a directory: {@link tailsReadAsOneRecord}. */
export interface TheRecordRead {
  /** The tails read, in the order given: none where the directory holds tails of two records. */
  readonly read: readonly string[];
  /**
   * The records the directory holds tails of, by name, where it holds two or more: then nothing
   * is read. Empty where its tails name one record or none.
   */
  readonly several: readonly RecordGroup[];
}

/**
 * THE TAILS A READING OF THE RECORD READS, from what each tail of the directory names (`named`,
 * `undefined` for a tail that names none). Where {@link recordOf} finds no name or one, every tail
 * is read: an unnamed tail in a named record stays what `verify` keeps it, a census note. Where the
 * named tails name two records or more, no tail is read, named or not, and the records are said:
 * a directory alone cannot tell which of them it is (FORMAT.md section 6.10 says why both readers
 * refuse it, `another-record`), so nothing in it governs until it holds one
 * (`record-name.test.ts`, "the tails a reading of the record reads").
 *
 * IT USED TO READ the record that held the genesis, by `at`, and leave the others out. A tail
 * grafted from a record older than this one then became the record read and this one's tails
 * the ones left out; the maintainer chose failing closed instead (ADR-148).
 */
export function tailsReadAsOneRecord(
  named: ReadonlyMap<string, string | undefined>,
): TheRecordRead {
  const naming = recordOf(named);
  return naming.state === 'several'
    ? { read: [], several: naming.groups }
    : { read: [...named.keys()], several: [] };
}

/** What arrived in a directory since a base, as {@link arrivedSince} reads it. */
export interface Arrivals {
  /**
   * The record the base is: the names its tails carry, or, where none carries one, the name of
   * its genesis tail. Empty where the base held no tail with an entry.
   */
  readonly records: readonly string[];
  /** The tails new since the base that name no record, where a tail of the base names one. */
  readonly unnamed: readonly string[];
  /**
   * The tails new since the base that name no record, where no tail of the base names one
   * either (a record written before records were named, or no record at all): the record has no
   * name yet, so such a tail is a note and not a refusal.
   */
  readonly noted: readonly string[];
  /** The tails new since the base that name a record the base is not, one group per name. */
  readonly foreign: readonly { readonly name: string; readonly tails: readonly string[] }[];
  /**
   * The tails a relink moves into the record here and did not move at the base (FORMAT.md section
   * 6.11), whether the base held the tail or it arrived since: a fact, never a refusal.
   */
  readonly relinked: readonly RelinkArrived[];
}

/** A tail a relink that counts here, and did not count at the base, moved into the record. */
export interface RelinkArrived {
  readonly tail: string;
  /** The record the tail's own artifacts name, which the relink moved it out of. */
  readonly from: string;
  /** How many events the tail holds. */
  readonly events: number;
  /** The `at` of its first entry. */
  readonly firstAt: string;
  /** Whether the base held the tail (it was in the record there) or it arrived since. */
  readonly held: boolean;
}

/** The relinks that count at the base and here, as {@link relinkedNaming} reads each side. */
export interface RelinksOnBothSides {
  readonly base: readonly RelinkCounted[];
  readonly here: readonly RelinkCounted[];
}

/**
 * THE TAILS THAT ARRIVED SINCE A BASE (FORMAT.md section 6.10), from what each tail names at the
 * base (`base`) and now (`here`), `undefined` for a tail that names none; `firsts` gives the first
 * entries of the base's tails, asked only where none of them names a record.
 *
 * A directory alone cannot tell which of two records was there first; the base can. A tail the
 * base did not hold is held to the record the base is: one that names another record is named
 * with the other tails of that record, and one that names no record (a tail written before
 * records were named, which is how a tail grafted from such a record arrives) is named where a
 * tail of the base names the record, and only noted where none does, the record having no name
 * yet to hold it to. A tail the base already held is not asked again, an unnamed one staying the
 * census note it was, unless it held no name there and names a record now: that name is held to
 * the base's record (where no tail of the base names it, the name its genesis tail derives, which
 * is the one a writer gives a record written before records were named), and another name, or
 * a base whose genesis is not found, puts it with the tails of another record.
 *
 * A TAIL ITS OWNER RELINKED (FORMAT.md section 6.11, ADR-155) is asked under the name the relink
 * gives it: `base` and `here` are what each tail names once the relinks that count on that side
 * are applied ({@link relinkedNaming}, the readers' own rule), so a change that brings a tail of
 * another record and its owner's relink of it holds no tail of another record where the relink
 * counts, and still does where it does not. `relinks` are the relinks that counted on each side;
 * those that count here and did not at the base are said in `relinked`, as a fact and never a
 * refusal, since the readers already refuse what a relink lacks (`record-name.test.ts`, "a tail
 * its owner relinked").
 */
export function arrivedSince(
  base: ReadonlyMap<string, string | undefined>,
  firsts: () => Iterable<{ readonly tail: string; readonly at: string }>,
  here: ReadonlyMap<string, string | undefined>,
  relinks: RelinksOnBothSides = { base: [], here: [] },
): Arrivals {
  const named = new Set([...base.values()].filter((name) => name !== undefined));
  const carried = named.size > 0;
  if (!carried) {
    const genesis = genesisTail(firsts());
    if (genesis !== undefined) named.add(recordName(genesis));
  }
  const unnamed: string[] = [];
  const noted: string[] = [];
  const foreign = new Map<string, string[]>();
  for (const [tail, name] of here) {
    // A tail the base held is asked again only where it held no name and names a record now: a
    // name it took since, held to the base's record like a tail that arrived, and refused where
    // the base gives no name to hold it to.
    const held = base.has(tail);
    if (held && (base.get(tail) !== undefined || name === undefined)) continue;
    if (name === undefined) {
      (carried ? unnamed : noted).push(tail);
      continue;
    }
    if (named.has(name) || (!held && named.size === 0)) continue;
    const tails = foreign.get(name);
    if (tails === undefined) foreign.set(name, [tail]);
    else tails.push(tail);
  }
  return {
    records: [...named].sort(),
    unnamed,
    noted,
    foreign: [...foreign]
      .map(([name, tails]) => ({ name, tails }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    relinked: relinks.here
      .filter(
        ({ relink }) =>
          !relinks.base.some(
            (there) => there.relink.tail === relink.tail && there.relink.into === relink.into,
          ),
      )
      .map(({ relink, events, firstAt }) => ({
        tail: relink.tail,
        from: relink.source,
        events,
        firstAt,
        held: base.has(relink.tail),
      })),
  };
}

/** The name both readers refuse a relink by that another key than the relinked tail's signed. */
export const RELINK_NOT_THE_OWNER = 'relink-not-the-owner';
/** The name both readers refuse a tail by that two covered relinks of its owner name. */
export const RELINK_CONFLICT = 'relink-conflict';
/** The name both readers refuse a relink by whose host tail is itself relinked. */
export const RELINK_HOSTED_BY_A_RELINKED_TAIL = 'relink-hosted-by-a-relinked-tail';
/** The name both readers refuse a relink by whose host does not name `into` by its own artifacts. */
export const RELINK_INTO_MISMATCH = 'relink-into-mismatch';
/** The name both readers refuse a relink by that names one record as both `from` and `into`. */
export const RELINK_INTO_ITS_OWN_RECORD = 'relink-into-its-own-record';
/** The name both readers refuse a relink by whose `from` is not the name the tail carries. */
export const RELINK_FROM_MISMATCH = 'relink-from-mismatch';
/** The name both readers refuse a relink by whose tail holds entries past the head it froze. */
export const RELINKED_TAIL_GREW = 'relinked-tail-grew';
/** The name both readers refuse a relink by whose head or count is not the tail's. */
export const RELINK_HEAD_MISMATCH = 'relink-head-mismatch';
/** The name both readers refuse a relink by whose key is no member of the record it joins then. */
export const RELINK_NOT_A_MEMBER = 'relink-not-a-member';

/** A `tail.relinked` as a reader found it: where it sits, who signed it, and what it says. */
export interface RelinkRead {
  /** The tail it is written in. */
  readonly host: string;
  readonly seq: number;
  readonly signerFp: string;
  /** The relinked tail. */
  readonly tail: string;
  /** The record the relinked tail is moved from: the payload's `from`. */
  readonly source: string;
  readonly into: string;
  readonly throughHash: string;
  readonly eventCount: number;
}

/** A relink both readers refuse, by its token, in the words they say it in. */
export interface RelinkRefused {
  readonly token:
    | typeof RELINK_NOT_THE_OWNER
    | typeof RELINK_CONFLICT
    | typeof RELINK_HOSTED_BY_A_RELINKED_TAIL
    | typeof RELINK_INTO_MISMATCH
    | typeof RELINK_INTO_ITS_OWN_RECORD
    | typeof RELINK_FROM_MISMATCH
    | typeof RELINKED_TAIL_GREW
    | typeof RELINK_HEAD_MISMATCH
    | typeof RELINK_NOT_A_MEMBER;
  readonly relink: RelinkRead;
  /** The sentence, ending in the token between parentheses. */
  readonly detail: string;
}

/** A relink that counts: the tail is read under `into`. */
export interface RelinkCounted {
  readonly relink: RelinkRead;
  /** How many events the relinked tail holds. */
  readonly events: number;
  /** The `at` of its first entry. */
  readonly firstAt: string;
  /** The census line both readers say. */
  readonly detail: string;
}

/** What {@link relinkedNaming} read of the relinks a directory holds. */
export interface RelinksRead {
  /** What each tail names once the relinks that count are applied. */
  readonly named: ReadonlyMap<string, string | undefined>;
  readonly counted: readonly RelinkCounted[];
  readonly refused: readonly RelinkRefused[];
  /** Relinks above their host's last verified checkpoint: chained only, counted for nothing. */
  readonly uncovered: readonly RelinkRead[];
  /** Covered relinks by the owner of a tail that is not in the directory: they name nothing. */
  readonly absent: readonly RelinkRead[];
}

/** One entry as the rule reads it. */
type EntryRead = ChainEntry;

/**
 * Where the identity fold refused an event, by tail and seq, over the tails it is handed: what
 * the rule asks of `resolveIdentity` (`enrollment.ts`). Handed in rather than imported, so this
 * module reads nothing and the rule can be asked of any fold, a test's included.
 */
export type FoldRefusals = (
  entriesByTail: ReadonlyMap<string, readonly EntryRead[]>,
  coveredThrough: ReadonlyMap<string, number>,
) => readonly { readonly tail: string; readonly seq: number }[];

/**
 * THE NAME A RELINK GIVES A TAIL (FORMAT.md section 6.11, ADR-155): the one rule both readers
 * apply, after every tail is read and named by its own artifacts (`named`) and before the
 * record's agreement ({@link recordOf}). `verify.ts` asks it; the namer of the surfaces asks
 * `verify` where a directory would hold two records and one of its tails holds a relink
 * (`tail-names.ts`); the second reader mirrors it check for check (`record.py`,
 * `_check_relinks`). Held in `record-name.test.ts` check by check, and over records both readers
 * read in `second-reader-agrees-on-a-relink.test.ts`.
 *
 * A `tail.relinked` in tail H, about tail T, counts when, in this order:
 *
 * 1. a verified checkpoint of H covers it (`coveredThrough`); above it the relink is chained
 *    only, a party with no key can append one there, and it is said and counts for nothing;
 * 2. it is signed by the key T's id names, which is H's key too (`relink-not-the-owner`);
 * 3. no other covered relink by that key names T (`relink-conflict`, once for the tail);
 * 4. H is not itself the tail of such a relink (`relink-hosted-by-a-relinked-tail`);
 * 5. H names `into` by its own artifacts (`relink-into-mismatch`), and `from` is another record
 *    (`relink-into-its-own-record`: a relink of a tail into the record it names would only freeze it);
 * 6. T is in the directory (else the relink is said, and names nothing) and names `from` by its
 *    own artifacts (`relink-from-mismatch`);
 * 7. T ends at `throughHash` with `eventCount` entries: more, through that head, is
 *    `relinked-tail-grew`, anything else `relink-head-mismatch`;
 * 8. the key holds, at the relink's point, a membership the record joined GAVE it
 *    (`relink-not-a-member`, ADR-157): the fold (`fold`) over the tails that name `into` by their
 *    own artifacts and that their owner did not relink, with every `identity.founded` left out but
 *    those of the record's genesis tail (the tail whose id `into` is the name of), refuses nothing
 *    at the relink. So a key counts as the founder of the genesis identity, or as a key that
 *    identity, or a key it took in, enrolled (`key.enrolled`, `agent.enrolled`); a key that founded
 *    its own identity in the record does not, and neither does a key only such a key enrolled,
 *    since any key may found its own identity anywhere and that is no act of the record's.
 *
 * The tails the last check folds are named by their artifacts alone, so the fold never reads a
 * tail whose name the rule is deciding, and the rule never waits on itself. Where the genesis
 * tail is not in the directory (cut, ADR-147), no founding counts and no relink into the record
 * does.
 *
 * A relink that counts names T `into`. T's own artifacts still name `from`, and they are not
 * compared with that name: `record-mismatch` stays a question among T's own artifacts. Nothing
 * else moves: a tail of `from` left behind keeps naming `from`, and {@link recordOf} says so.
 */
export function relinkedNaming(
  named: ReadonlyMap<string, string | undefined>,
  entriesByTail: ReadonlyMap<string, readonly EntryRead[]>,
  coveredThrough: ReadonlyMap<string, number>,
  fold: FoldRefusals,
): RelinksRead {
  const found: { readonly relink: RelinkRead; readonly covered: boolean }[] = [];
  for (const [host, entries] of entriesByTail) {
    for (const entry of readEntries(entries)) {
      const event = entry.event;
      if (event.kind !== 'tail.relinked') continue;
      const { tail, from: source, into, throughHash, eventCount } = event.payload;
      found.push({
        relink: {
          host,
          seq: entry.link.seq,
          signerFp: event.signerFp,
          tail,
          source,
          into,
          throughHash,
          eventCount,
        },
        covered: entry.link.seq <= (coveredThrough.get(host) ?? -1),
      });
    }
  }
  if (found.length === 0) return { named, counted: [], refused: [], uncovered: [], absent: [] };

  const uncovered = found.filter((one) => !one.covered).map((one) => one.relink);
  const refused: RelinkRefused[] = [];
  const refuse = (token: RelinkRefused['token'], relink: RelinkRead, detail: string): void => {
    refused.push({ token, relink, detail: `${detail} (${token})` });
  };

  // Steps 1 and 2: the covered relinks the relinked tail's own key signed, by the tail they name.
  const byTail = new Map<string, RelinkRead[]>();
  for (const { relink, covered } of found) {
    if (!covered) continue;
    const owner = tailFingerprint(relink.tail);
    if (relink.signerFp !== owner || tailFingerprint(relink.host) !== owner) {
      refuse(
        RELINK_NOT_THE_OWNER,
        relink,
        `${oneLine(where(relink))} relinks tail ${oneLine(relink.tail)}, signed by ${oneLine(relink.signerFp.slice(0, 12))}..., not the key that tail's id names`,
      );
      continue;
    }
    const relinks = byTail.get(relink.tail);
    if (relinks === undefined) byTail.set(relink.tail, [relink]);
    else relinks.push(relink);
  }

  const absent: RelinkRead[] = [];
  const admitted: RelinkRead[] = [];
  for (const [tail, relinks] of byTail) {
    const relink = relinks[0] as RelinkRead;
    if (relinks.length > 1) {
      refuse(
        RELINK_CONFLICT,
        relink,
        `tail ${oneLine(tail)} is relinked ${relinks.length} times (${oneLine(relinks.map(where).join(', '))}): a tail is relinked once`,
      );
      continue;
    }
    if (byTail.has(relink.host)) {
      refuse(
        RELINK_HOSTED_BY_A_RELINKED_TAIL,
        relink,
        `${oneLine(where(relink))} relinks tail ${oneLine(tail)}, and is itself relinked: a relink counts only from a tail that names its record by its own artifacts`,
      );
      continue;
    }
    const hostNames = named.get(relink.host);
    if (hostNames !== relink.into) {
      refuse(
        RELINK_INTO_MISMATCH,
        relink,
        `${oneLine(where(relink))} relinks tail ${oneLine(tail)} into record ${oneLine(relink.into.slice(0, 12))}..., and names ${oneLine(recordSaid(hostNames))} itself`,
      );
      continue;
    }
    if (relink.source === relink.into) {
      refuse(
        RELINK_INTO_ITS_OWN_RECORD,
        relink,
        `${oneLine(where(relink))} relinks tail ${oneLine(tail)} from record ${oneLine(relink.source.slice(0, 12))}... into the same record: a relink moves a tail between two records`,
      );
      continue;
    }
    if (!named.has(tail)) {
      absent.push(relink);
      continue;
    }
    const tailNames = named.get(tail);
    if (tailNames !== relink.source) {
      refuse(
        RELINK_FROM_MISMATCH,
        relink,
        `${oneLine(where(relink))} relinks tail ${oneLine(tail)} from record ${oneLine(relink.source.slice(0, 12))}..., and that tail names ${oneLine(recordSaid(tailNames))}`,
      );
      continue;
    }
    const entries = entriesByTail.get(tail) ?? [];
    const head = entries.at(-1)?.link.hash;
    if (head !== relink.throughHash || entries.length !== relink.eventCount) {
      if (
        entries.length > relink.eventCount &&
        entries[relink.eventCount - 1]?.link.hash === relink.throughHash
      ) {
        refuse(
          RELINKED_TAIL_GREW,
          relink,
          `tail ${oneLine(tail)} holds ${entries.length} event(s), and the relink at ${oneLine(where(relink))} froze it at ${relink.eventCount}`,
        );
      } else {
        refuse(
          RELINK_HEAD_MISMATCH,
          relink,
          `tail ${oneLine(tail)} ends at ${oneLine((head ?? 'nothing').slice(0, 12))}... with ${entries.length} event(s), not at the head ${oneLine(relink.throughHash.slice(0, 12))}... with ${relink.eventCount} the relink at ${oneLine(where(relink))} names`,
        );
      }
      continue;
    }
    admitted.push(relink);
  }

  // Step 8, once per record joined: the fold over the tails that name it by their own artifacts
  // and that their owner did not relink, with no founding but the genesis tail's.
  const refusedIn = new Map<string, ReadonlySet<string>>();
  for (const into of new Set(admitted.map((relink) => relink.into))) {
    const tails = [...named.keys()].filter((tail) => named.get(tail) === into && !byTail.has(tail));
    const given = (tail: string): readonly EntryRead[] => {
      const entries = entriesByTail.get(tail) ?? [];
      return recordName(tail) === into
        ? entries
        : entries.filter((entry) => entry.event.kind !== 'identity.founded');
    };
    const refusals = fold(
      new Map(tails.map((tail) => [tail, given(tail)])),
      new Map(tails.map((tail) => [tail, coveredThrough.get(tail) ?? -1])),
    );
    refusedIn.set(into, new Set(refusals.map((one) => `${one.tail}#${one.seq}`)));
  }
  const relinkedNamed = new Map(named);
  const counted: RelinkCounted[] = [];
  for (const relink of admitted) {
    if (refusedIn.get(relink.into)?.has(`${relink.host}#${relink.seq}`)) {
      refuse(
        RELINK_NOT_A_MEMBER,
        relink,
        `${oneLine(where(relink))} relinks tail ${oneLine(relink.tail)}, and its key holds no membership record ${oneLine(relink.into.slice(0, 12))}... gave it at that point: the founding of its genesis identity, or an enrolment by a member that founding took in`,
      );
      continue;
    }
    relinkedNamed.set(relink.tail, relink.into);
    const entries = entriesByTail.get(relink.tail) ?? [];
    const firstAt = entries[0]?.event.at ?? '';
    counted.push({
      relink,
      events: entries.length,
      firstAt,
      detail: `tail ${oneLine(relink.tail)}, record ${oneLine(relink.source.slice(0, 12))}..., relinked into this record by its own key at ${oneLine(where(relink))}: ${entries.length} event(s), the first at ${oneLine(firstAt)}`,
    });
  }
  return { named: relinkedNamed, counted, refused, uncovered, absent };
}

/** Where a relink sits, as both readers say it. */
function where(relink: RelinkRead): string {
  return `tail ${relink.host} seq ${relink.seq}`;
}

/** A record's name as a sentence says it, or that there is none. */
function recordSaid(name: string | undefined): string {
  return name === undefined ? 'no record' : `record ${name.slice(0, 12)}...`;
}
