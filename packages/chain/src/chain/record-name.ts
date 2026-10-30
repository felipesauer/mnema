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
 * genesis tail, as information, when one of them hashes to the name.
 */

import { framedTextDigest } from './hash.js';

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
 */
export function recordToWriteUnder(
  tail: string,
  named: ReadonlyMap<string, string | undefined>,
  firsts: () => Iterable<{ readonly tail: string; readonly at: string }>,
  continues: () => string | undefined = () => undefined,
): WriteUnder {
  const own = named.get(tail);
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
 */
export function arrivedSince(
  base: ReadonlyMap<string, string | undefined>,
  firsts: () => Iterable<{ readonly tail: string; readonly at: string }>,
  here: ReadonlyMap<string, string | undefined>,
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
  };
}
