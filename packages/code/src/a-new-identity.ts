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
 * WHAT TO DO WAS ONE CLAUSE, AND FOLLOWED TO THE LETTER IT SAVED NOTHING. It read "then
 * `mnema key enroll` wherever its key is", which says who vouches and not where the vouch lands —
 * and it lands in the committed tree of the project the command is run in, and nowhere else
 * (`commands/key-enroll.ts`): whether a key adopts an identity is asked of the record of the tree
 * it writes to, at its first write there. Measured on the built binary: the machine already in the
 * identity enrolled the key where it stood, in the project that had just split, and the key's
 * first write in the next project founded again — two authors there as well. So the words now say
 * where (inside each of the other projects), by whom (a machine already in that identity), and in
 * what order (the record committed and shared there, then pulled here before this key's first
 * write) — and `tests/a-write-says-what-it-founded.test.ts` follows them to the letter across two
 * projects, beside the enrollment made where the old words led.
 *
 * AND WHERE NOT: nowhere this key has already written, this project first. There an enrollment
 * ALONE joins nothing — the installation that founded goes on speaking for the identity it
 * founded — and the record then proves the key a member of two identities, which a fresh clone
 * refuses to write as rather than choose (`AMBIGUOUS_MEMBERSHIP`); measured, and asserted in the
 * same file. THE WORDS SAID "the enrollment joins nothing", and that holds only while the key is
 * the one it founded's only key: with another key brought into that identity first, the key
 * leaves it from the checkout that founded it and joins the other — the way out that refusal
 * hands over, followed to the letter in `the-refusal-names-the-way-out.test.ts`. The trees kept on
 * one machine have words of their own ({@link BY_TREE}): no enrollment reaches them, so what they
 * can still spare is the public trees of the person's projects.
 *
 * THE FIRST WORDS NAME THE KEY, NOT THE WRITE. They were "This founded a new identity", and writes
 * that founded nothing earned them too: a fresh clone of a record in which this key had founded
 * beside others, and a `mnema key restore` of that key into one, each settle the key's anchor by
 * ADOPTING the founding the record already holds — no `identity.founded` is appended, measured two
 * before and two after — while what is detected is that the key's anchor appeared, that the record
 * shows the key founded beside others, and that the anchor it settled IS the one it founded
 * ({@link foundingsSince}). That is one fact about the key, true in all three, so the sentence says
 * it of the key. Telling a second installation from the first would take a reading of the record
 * before every write, and this makes none.
 *
 * The command line writes each sentence on stderr after the verb's answer; the server puts it in
 * the reply of the call whose write founded, and in the hook's `additionalContext` when that write
 * was the hook's. Both ask this module.
 */

import { catalogUpcasters, listAnchoredFingerprints, readAnchor } from '@mnema/chain';
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

/** What the sentence says that depends on the tree the founding happened in. */
interface TreeWords {
  /** Who the new identity can be, read off where the tree is kept. */
  readonly who: string;
  /** How the same person comes to be written here under a second identity. */
  readonly how: string;
  /** What else goes on counting the person twice, past this tree — empty when nothing does. */
  readonly beyond: string;
  /** The trees an enrollment can still spare. */
  readonly spared: string;
  /** Who the request is handed to: whoever can vouch for this key. */
  readonly vouching: string;
  /** Where the enrollment must not go, and why — empty when nothing the words name leads there. */
  readonly notHere: string;
}

/**
 * What a founding beside others can have been, and what is still in reach, by the tree it
 * happened in — a record over the closed set of scopes, so a tree the core adds does not compile
 * here until it has words.
 *
 * THE PUBLIC TREE travels, so a founding there may be a person new to the record. The words keep
 * the enrollment out of this project by name, because it is the tree this key founded in and the
 * one a reader is likeliest to want mended; every other project this key has written in is kept
 * out by "where this key has not written yet", for the same reason.
 *
 * THE PRIVATE AND GLOBAL TREES are kept on one machine, so the identity already there was written
 * from this machine too, under a key it no longer signs with. No enrollment reaches a tree kept on
 * one machine — `key enroll` writes the public tree of a project and nothing else — so every other
 * such tree the old key wrote in counts the person twice as soon as this key writes there, and the
 * old words, "your other projects can still count you once", promised what no command can do. What
 * an enrollment can spare is the public trees of the person's projects; after a private founding
 * that includes this project's own, which this key may not have written yet. And the machine that
 * can vouch may be this one: the identity was written from here, so if the key it was written with
 * is still on the disk, a `key enroll` signed with it is a member's vouch.
 */
const BY_TREE: Readonly<Record<Scope, TreeWords>> = {
  public: {
    who:
      'If you are new to this record, this is how everyone after the first arrives, and there ' +
      'is nothing to do.',
    how: 'on another machine, or under another key',
    beyond: '',
    spared: 'the public trees of your other projects',
    vouching: 'a machine already in that identity',
    notHere:
      'Not in this project by an enrollment alone: here it joins nothing until another key takes ' +
      'this one’s place in the identity it just founded, and every fresh clone of it would refuse ' +
      'this key’s writes meanwhile.',
  },
  private: {
    who: 'This tree is kept on this machine alone, so that identity was written from here too.',
    how: 'under another key',
    beyond:
      ', and so will every other tree this machine keeps to itself that the other key wrote in, ' +
      'once this key writes there — no enrollment reaches a tree kept on one machine',
    spared: 'the public trees of your projects, this one’s included,',
    vouching:
      'a machine already in that identity (this one, if it still holds the key that identity ' +
      'wrote with here)',
    notHere: '',
  },
  global: {
    who: 'This tree is kept on this machine alone, so that identity was written from here too.',
    how: 'under another key',
    beyond:
      ', and so will every other tree this machine keeps to itself that the other key wrote in, ' +
      'once this key writes there — no enrollment reaches a tree kept on one machine',
    spared: 'the public trees of your projects',
    vouching:
      'a machine already in that identity (this one, if it still holds the key that identity ' +
      'wrote with here)',
    notHere: '',
  },
};

/**
 * The sentence for one identity a key founded beside others, in the tree of `scope`.
 *
 * Every command in it is written to be run where the sentence says, in the order it says them,
 * and nothing else is asked of the reader: the request here, where the short anchor resolves;
 * the enrollment on the machine that can vouch, inside each project it is meant for, because that
 * is the record it lands in; and the pull here, because this key adopts an identity only by
 * reading the vouch in the record of the tree it writes to, at its first write there.
 */
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
  const tree = BY_TREE[scope];
  return oneLine(
    `This key founded an identity of its own in the ${scope} tree, ${named(founded.anchor)}, ` +
      `beside ${founded.besides.length} already there (${which}). ${tree.who} ` +
      `If ${one ? 'that identity' : 'one of them'} is you — ${tree.how} — this tree counts you ` +
      `twice from now on${tree.beyond}; ${tree.spared} can still count you once where this key ` +
      `has not written yet: run \`mnema key request --anchor ${target}\` here, hand the line it ` +
      `prints to ${tree.vouching}, which runs \`mnema key enroll <the line>\` inside each of ` +
      'those projects and commits and shares the record, and pull it here before this key ' +
      `writes there.${tree.notHere === '' ? '' : ` ${tree.notHere}`}`,
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
 * The sentences owed after a write: one for every key that settled its anchor in a tree during it,
 * IN the identity that tree's record shows it founded there beside others.
 *
 * This said "a key that ADOPTED an identity on the record settles its anchor too, and is owed
 * nothing", and that holds for a key another member vouched for — the handshake the page
 * describes — but not for a key adopting a founding of ITS OWN, which is what a fresh clone of the
 * record, or a `mnema key restore` into one, does: the anchor appears, the record shows the key's
 * founding beside others, and the sentence is owed again although nothing was appended. Measured;
 * the case that pins it is in `tests/a-write-says-what-it-founded.test.ts`, and the words are
 * written about the key so that they are true there too.
 *
 * AND IT ASKED ONLY WHETHER THE KEY HAD FOUNDED, which is not whom it speaks for. A key that left
 * the identity it founded — another key brought in, this one retired, the way out a refusal of
 * two identities hands over — adopts the other one in every fresh clone after, and the record
 * still holds its founding: measured on the binary, that clone, speaking for the other identity,
 * was told "This key founded an identity of its own", with the advice to enroll. The sentence is
 * owed where the anchor the key settled IS the identity it founded, and
 * `tests/the-refusal-names-the-way-out.test.ts` asks the clone after the way out.
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
      if (founded === undefined) continue;
      if (readAnchor({ root }, fingerprint) !== founded.anchor) continue;
      sentences.push(foundingSentence(founded, scope));
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
