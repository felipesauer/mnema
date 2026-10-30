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
 * - `foreign`: the writer's own tail names `own`, and every other named tail names `record`: its
 *   tail is the one of another record, and growing it grows what both readers refuse.
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
 *    of the genesis tail, by the first entries `firsts` gives, asked for only here; with no tail
 *    holding a first entry, the writer's own tail is the genesis: a new record names itself.
 *
 * Refused, whatever the writer's own tail names, where the other tails name two records; and
 * where its own tail names one and the other named tails another.
 */
export function recordToWriteUnder(
  tail: string,
  named: ReadonlyMap<string, string | undefined>,
  firsts: () => Iterable<{ readonly tail: string; readonly at: string }>,
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
  return { name: recordName(genesisTail(firsts()) ?? tail) };
}
