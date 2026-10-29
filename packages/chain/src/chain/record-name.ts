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
