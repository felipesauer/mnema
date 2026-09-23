/**
 * What this product says about a `.mnema/` it will not take for a project — worded once,
 * for both surfaces.
 *
 * The walk that finds a project passes over two kinds of `.mnema/`: the home directory's,
 * and any machine's data directory (`whyNoProjectRootAt`, `@mnema/core`). Passing one over
 * is right, and it is also a change a person can be caught by. A home's `.mnema/` can hold
 * events written there before the walk learned to pass it — this machine had one, with a
 * task in it, created from a folder under the home — and a walk that went by in silence
 * would make those events vanish from every answer that used to carry them, with nothing
 * anywhere saying where they went.
 *
 * SO IT SAYS: that the tree is there, where, why it is not a project, and how many events
 * it holds. It does not say what to do with them. Importing them into the project they
 * belonged to, or leaving them where they are, is a decision about somebody's record, and
 * the record is append-only — nothing here moves, rewrites or removes a byte of it.
 *
 * The command line writes each sentence on stderr before a verb's answer, and the MCP
 * server writes it in its log when a session opens. Both ask this module, because a second
 * wording of one fact is the shape that comes to disagree in silence.
 */

import { join } from 'node:path';
import { catalogUpcasters, listTails, tailStanding } from '@mnema/chain';
import {
  type DiscoveryEnv,
  discover,
  type NoProjectRoot,
  type PassedOverTree,
  PRIVATE_DIR,
} from '@mnema/core';
import { oneLine } from './one-line.js';

/**
 * Why a directory is no project's root, in the words every surface says it with.
 *
 * A record over the closed set, so a reason the core adds does not compile here until it
 * has words — the totality lives in the source, where the compiler reads it.
 */
export const WHY_NO_PROJECT_ROOT: Readonly<Record<NoProjectRoot, string>> = {
  home: 'the home directory is never a project’s root, since every folder under it would belong to that project',
  'data-directory':
    'it holds a key root, which makes it a machine’s data directory and not a project’s tree',
};

/** What a passed-over tree holds, counted over its committed half and its private one. */
export interface HeldThere {
  /** The events in the tails that read. */
  readonly events: number;
  /** The tails that read. */
  readonly tails: number;
  /** The tails that could not be read — counted, never guessed at. */
  readonly unreadable: number;
}

/**
 * Counts what a `.mnema/` holds, by the reading `mnema tail list` counts a tail with
 * (`tailStanding`), so "N event(s)" means the same thing in both places.
 *
 * READ-ONLY BY CONSTRUCTION: a directory listing and each tail's segments, no writer, no
 * lock, no cache. A tail that will not parse is counted as unreadable rather than letting
 * the throw reach the verb this is said before — a sentence about a tree nobody asked
 * about must never be the reason an answer did not arrive.
 */
export function heldIn(tree: string): HeldThere {
  let events = 0;
  let tails = 0;
  let unreadable = 0;
  const upcasters = catalogUpcasters();
  for (const root of [tree, join(tree, PRIVATE_DIR)]) {
    let listed: readonly string[];
    try {
      listed = listTails({ root });
    } catch {
      // A tails directory that will not list is a tree whose tails cannot be read — one,
      // since how many it holds is exactly what could not be learned.
      unreadable += 1;
      continue;
    }
    for (const tail of listed) {
      try {
        events += tailStanding({ root }, tail, upcasters)?.eventCount ?? 0;
        tails += 1;
      } catch {
        unreadable += 1;
      }
    }
  }
  return { events, tails, unreadable };
}

/**
 * The sentence for one passed-over tree, or `undefined` when it holds nothing to lose.
 *
 * A data directory holding only its key root and its global tree is the ordinary case on
 * every machine without `$XDG_DATA_HOME`, and it is passed over on every walk from under
 * the home: saying so there would be a line on every command, about nothing. So the line
 * is owed only where there are TAILS — events written as a project's, which no answer
 * reads any more.
 */
export function passedOverSentence(passed: PassedOverTree, held: HeldThere): string | undefined {
  if (held.tails === 0 && held.unreadable === 0) return undefined;
  const count =
    held.unreadable === 0
      ? `${held.events} event(s) in ${held.tails} tail(s)`
      : `${held.events} event(s) in ${held.tails} tail(s), and ${held.unreadable} tail(s) that could not be read`;
  return oneLine(
    `${passed.tree} is not taken for a project: ${WHY_NO_PROJECT_ROOT[passed.why]}. ` +
      `It holds ${count}, recorded there as a project’s — left as they are: ` +
      'nothing here reads them into an answer, and nothing is written beside them.',
  );
}

/** Every sentence owed for what a walk passed over, in the order the walk met the trees. */
export function passedOverSentences(passedOver: readonly PassedOverTree[]): string[] {
  const sentences: string[] = [];
  for (const passed of passedOver) {
    const sentence = passedOverSentence(passed, heldIn(passed.tree));
    if (sentence !== undefined) sentences.push(sentence);
  }
  return sentences;
}

/**
 * The sentences owed for the walk from `cwd` — the walk every verb run there resolves its
 * trees by (`discover` is `resolveTrees` with its passed-over half kept), so what is said
 * is about the walk the answer came from.
 */
export function passedOverFrom(cwd: string, env: DiscoveryEnv): string[] {
  return passedOverSentences(discover(cwd, env).passedOver);
}
