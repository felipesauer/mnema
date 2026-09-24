/**
 * What this product says when a write founds an identity where others already were — worded
 * once, for both surfaces.
 *
 * A key's first write into a tree settles whom it speaks for there, and when the record proves it
 * a member of nobody, it founds an identity of its own (`ensureFounded`, `@mnema/core`). Beside the
 * identities a tree already holds, that founding is two different events that read the same: a
 * person new to the record, which is how every team member after the first arrives, and one
 * person arriving under a second key — a machine that wrote before it was enrolled, a key lost and
 * minted again, a key root a launcher moved. The product cannot tell them apart. What it can do is
 * not do it in silence, because the second case cannot be undone in that tree afterwards: the key
 * that founded goes on speaking as its own identity there, whatever is enrolled later.
 *
 * SO IT SAYS, ONCE, AT THE WRITE: which identity was founded, beside which, what it means if that
 * was somebody new (nothing to do), and what to do if it was the same person — which is to save
 * the OTHER trees, before this key writes in them too. It names the symptom, never a cause: which
 * program moved a key is not something the record knows, and a list of culprits would be wrong the
 * day the next one appears. And it is said once per identity per tree, at the moment it happened;
 * the record keeps the founding, and `mnema accountability` names it whenever somebody asks.
 *
 * The command line writes each sentence on stderr after the verb's answer; the server puts it in
 * the reply of the call whose write founded, and in the hook's `additionalContext` when that write
 * was the hook's. Both ask this module.
 */

import { catalogUpcasters, listAnchoredFingerprints } from '@mnema/chain';
import {
  chainRootForScope,
  type FoundedBeside,
  foundedBesideBy,
  type ResolvedTrees,
  type Scope,
  shortenAnchors,
} from '@mnema/core';
import { oneLine } from './one-line.js';

/** How many of the identities already there a sentence names before it counts the rest. */
const NAMED = 3;

/**
 * What a founding beside others can have been, by the tree it happened in — a record over the
 * closed set of scopes, so a tree the core adds does not compile here until it has words.
 *
 * The public tree travels, so a founding there may be a person new to the record. The private and
 * global trees are kept on one machine, so the identity already there was written from this
 * machine too.
 */
const WHAT_IT_CAN_HAVE_BEEN: Readonly<
  Record<Scope, { readonly who: string; readonly how: string }>
> = {
  public: {
    who: 'Someone new to this record reads exactly this and has nothing to do.',
    how: 'on another machine, or under another key',
  },
  private: {
    who: 'This tree is kept on this machine alone, so that identity was written from here too.',
    how: 'under another key',
  },
  global: {
    who: 'This tree is kept on this machine alone, so that identity was written from here too.',
    how: 'under another key',
  },
};

/** The sentence for one identity a write founded beside others, in the tree of `scope`. */
export function foundingSentence(founded: FoundedBeside, scope: Scope): string {
  const short = shortenAnchors([founded.anchor, ...founded.besides]);
  const named = (anchor: string): string => short.get(anchor) ?? anchor;
  const shown = founded.besides.slice(0, NAMED).map(named);
  const more = founded.besides.length - shown.length;
  const which =
    more > 0
      ? `${shown.join(', ')}, and ${more} more — \`mnema accountability\` names them`
      : shown.join(', ');
  const one = founded.besides.length === 1;
  // With one identity beside it, the command is the one to copy: `key request` resolves a short
  // anchor against the record it is run in, and "here" is that record.
  const target = one ? named(founded.besides[0] as string) : '<that identity>';
  const { who, how } = WHAT_IT_CAN_HAVE_BEEN[scope];
  return oneLine(
    `This founded a new identity in the ${scope} tree, ${named(founded.anchor)}, beside ` +
      `${founded.besides.length} already there (${which}). ${who} ` +
      `If ${one ? 'that identity' : 'one of them'} is you — ${how} — this tree counts you ` +
      'twice from now on, and your other projects can still count you ' +
      'once: before this key writes in them, enroll it into that identity with ' +
      `\`mnema key request --anchor ${target}\` here, then \`mnema key enroll\` wherever its key is.`,
  );
}

/** A tree a write may land in, with the name it is called by. */
export interface WatchedTree {
  readonly root: string;
  readonly scope: Scope;
}

/** Every tree the resolution reached, with its scope — the ones a verb run there may write to. */
export function treesOf(trees: ResolvedTrees): WatchedTree[] {
  const watched: WatchedTree[] = [];
  for (const scope of ['public', 'private', 'global'] as const) {
    const root = chainRootForScope(trees, scope);
    if (root !== undefined) watched.push({ root, scope });
  }
  return watched;
}

/**
 * The keys that had settled an anchor in each tree, read before a write — keyed by the tree's
 * root. READ-ONLY: a directory listing per tree, nothing opened.
 */
export type AnchorsBefore = ReadonlyMap<
  string,
  { readonly scope: Scope; readonly anchored: ReadonlySet<string> }
>;

/** Reads, before a write, which keys have an anchor in each of `trees`. */
export function anchorsBefore(trees: readonly WatchedTree[]): AnchorsBefore {
  const before = new Map<string, { scope: Scope; anchored: ReadonlySet<string> }>();
  for (const { root, scope } of trees) {
    if (!before.has(root)) before.set(root, { scope, anchored: anchoredIn(root) });
  }
  return before;
}

/**
 * The sentences owed after a write: one for every key that settled its anchor in a tree during it
 * AND founded an identity there beside others — a key that ADOPTED an identity on the record
 * settles its anchor too, and is owed nothing.
 *
 * The record is read only for a tree where an anchor appeared, which is a key's first write into
 * it: once per tree per key, for the life of the installation.
 */
export function foundingsSince(before: AnchorsBefore): string[] {
  const sentences: string[] = [];
  const upcasters = catalogUpcasters();
  for (const [root, { scope, anchored }] of before) {
    for (const fingerprint of anchoredIn(root)) {
      if (anchored.has(fingerprint)) continue;
      const founded = foundedBesideBy(root, fingerprint, upcasters);
      if (founded !== undefined) sentences.push(foundingSentence(founded, scope));
    }
  }
  return sentences;
}

/**
 * What a session of the server has opened to write to since its last reply, and what it owes
 * about it.
 *
 * `opened` is called at the one door every write context of the server is built through, so a
 * tool added later is watched by construction; `take` is called where a reply is composed, and
 * empties what it read, so a founding is said in one reply and not in every one after it.
 */
export class FoundingWatch {
  private watched = new Map<string, { scope: Scope; anchored: ReadonlySet<string> }>();

  /** Remembers which keys had an anchor in the tree at `root`, the first time it is opened. */
  opened(root: string, scope: Scope): void {
    if (!this.watched.has(root)) this.watched.set(root, { scope, anchored: anchoredIn(root) });
  }

  /** The sentences owed for what was opened since the last take, and forgets it. */
  take(): string[] {
    const was = this.watched;
    this.watched = new Map();
    return foundingsSince(was);
  }
}

/** The keys with a local anchor in the tree at `root`. */
function anchoredIn(root: string): ReadonlySet<string> {
  return new Set(listAnchoredFingerprints({ root }));
}
