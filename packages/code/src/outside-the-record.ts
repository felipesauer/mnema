/**
 * The decision documents this repository holds that the record has NO decision for —
 * a fact about this checkout, for the one reader who can do something about it.
 *
 * WHAT IT ANSWERS, AND WHY NOBODY WAS BEING TOLD. `mnema decision import <dir>` reads
 * the markdown decisions a project already wrote and proposes them; running it is a
 * gesture somebody has to remember. Measured on a real project: four documents in a
 * base the record had already imported from were outside it, three of them written the
 * day before, with the product running the whole time. Nothing anywhere said so — not
 * the opening read, not the document a session opens with — so the only way to find out
 * was to run the import and look, which is exactly the gesture nobody remembered.
 *
 * IT IS A READING OF THE DISK, WHICH IS WHY IT IS HERE AND NOT IN `@mnema/copilot`.
 * That package derives over caches and touches no filesystem, and `bootstrap` — its
 * opening context — is served byte for byte to the agent surface and to `mnema status
 * --json`. A count of files in one checkout inside that answer would put a fact about
 * ONE MACHINE into the payload two doors promise is the same answer, and would move
 * when somebody switched branch. So it rides BESIDE the derivation, from this package,
 * and the reading that prints it says which of the two each line came from.
 *
 * IT IS NOT IN THE `brief` EITHER, and that is the sharper half of the same rule. The
 * document `mnema brief` prints is committed and checked with `mnema brief | diff -
 * <the file>`, so it may hold no clock, no session and no path — a count of files in a
 * working tree would make that check report a difference that is not the record's. The
 * fact belongs where the gesture is: at the terminal of the person who decides what to
 * import, which is `mnema status`.
 *
 * THE FIRST READING NAMES NO DIRECTORY OF ITS OWN. `scanAdrDirectory`'s rule is that the
 * caller names the base and the product never picks one, and {@link
 * decisionsOutsideTheRecord} keeps it: its directories come out of the RECORD. Every
 * decision the import wrote carries a `derived-from` edge to the file it came from, so a
 * base this project has imported from is a base the record itself names.
 *
 * AND THAT PARAGRAPH ENDED *"a project that has never imported ... answers nothing at all
 * — which is the right answer rather than a special case"*. It is quoted rather than
 * deleted because {@link basesNeverImported} makes it false, and what falsified it is a
 * measurement: a real project holding 416 decisions, none of them imported, is answered by
 * `mnema status` with `No decisions in force` and silence. Silence is the right answer
 * about a directory nobody named; it is the wrong answer about whether this product has
 * anything to say to somebody standing in a repository full of decisions. The reading that
 * said nothing was not wrong — it was the only reading there was.
 *
 * SO THE SECOND READING DOES NAME DIRECTORIES, AND THE DOCTRINE IT LOOKS LIKE IT BREAKS IS
 * ABOUT SOMETHING ELSE. `scan.ts` forbids guessing a directory because a walk pointed at a
 * repository root *"would read every markdown file in it — a README, a changelog, an issue
 * template — and propose whatever happened to have a heading and a paragraph"*. That reason
 * is about PROPOSING, and its whole cost is a permanent entry in an append-only record that
 * nobody chose. {@link basesNeverImported} proposes nothing and opens nothing: it lists file
 * NAMES in {@link CONVENTIONAL_BASES} and reports a count beside the verb that would read
 * them. A wrong guess costs one false line in a `status` that a person reads and ignores.
 * Those are risks of different orders, and the doctrine was written about the other one —
 * which is why it stands unchanged over the import and is stated here as the limit of this
 * reading rather than inherited by it.
 *
 * IT COUNTS WHAT THE RECORD HAS NO EDGE INTO, NEVER WHAT IS MISSING FROM A BASE IT KNOWS.
 * A base the record names at all is {@link decisionsOutsideTheRecord}'s subject, and this
 * skips it entirely — a directory reported by both would be one fact worded two ways, and
 * the second wording would be the weaker one.
 */

import { join } from 'node:path';
import type { ScopedCache } from '@mnema/copilot';
import { adrFileNames, DERIVED_FROM_RELATION } from '@mnema/core';

/** One decision base, and how many of its documents the record has no decision for. */
export interface DecisionsOutside {
  /**
   * The directory, as the RECORD names it — a path relative to the project root, in
   * POSIX form, which is how `decision import` records the provenance of a proposal.
   *
   * It is the record's spelling rather than this machine's absolute path for the
   * reason every other printed value is: it is what a reader types back, and an
   * absolute path in a terminal answer says where somebody's home directory is to no
   * purpose.
   */
  readonly directory: string;
  /**
   * How many decision documents in it are the target of no `derived-from` edge in any
   * tree this caller can see.
   *
   * IT IS "NOT IN THE RECORD" AND NOT "WOULD BE IMPORTED", and the difference is worth
   * carrying. A file named here may still be refused by the scan — retired by its own
   * status, over the field limit, or holding something shaped like a credential — so
   * this counts documents a person may want to look at, never proposals the record
   * would accept. The verb that decides is `decision import`, and the reading names it.
   *
   * Never zero on an entry that is reported: a base whose every document is in the
   * record has nothing to say, and saying it would fill a screen with lines that carry
   * no fact.
   */
  readonly outside: number;
}

/**
 * The bases named in `sources`, each with how many of its documents are outside the
 * record — in directory order, and only those with something outside.
 *
 * EVERY TREE IS READ, not only the one that travels. A proposal that landed in the
 * private tree on an earlier run is still a decision derived from that file, and
 * reporting the file as outside because the public tree cannot see it would send a
 * person to import something twice — the same reasoning `decision import`'s own
 * idempotency is built on, and it is that read's rule kept rather than a second one.
 *
 * `root` is the project root the record's paths are relative to (`dirname` of the
 * committed tree), and nothing resolved from it may leave it: see {@link insideRoot}.
 */
export function decisionsOutsideTheRecord(
  sources: readonly ScopedCache[],
  root: string,
): DecisionsOutside[] {
  const imported = importedTargets(sources);
  const found: DecisionsOutside[] = [];
  for (const directory of [...basesOf(imported)].sort()) {
    const names = adrFileNames(join(root, ...directory.split('/')));
    const outside = names.filter((name) => !imported.has(inBase(directory, name))).length;
    if (outside > 0) found.push({ directory, outside });
  }
  return found;
}

/**
 * The `derived-from` targets inside this project, over every tree the caller can see —
 * the record's own account of which files it has read a decision out of.
 *
 * IT IS ONE READING FOR BOTH ANSWERS below. The two differ in what they do with it — one
 * asks which documents of a named base are missing, the other asks which bases are named
 * at all — and a second walk of the same relation is how they would come to disagree
 * about whether a base counts as known, so that one directory ended up in both sections.
 */
function importedTargets(sources: readonly ScopedCache[]): ReadonlySet<string> {
  const imported = new Set<string>();
  for (const source of sources) {
    for (const edge of source.cache.linksByRelation(DERIVED_FROM_RELATION)) {
      if (insideRoot(edge.target)) imported.add(edge.target);
    }
  }
  return imported;
}

/** The directories those targets sit in — `.` for a file imported from the root. */
function basesOf(targets: ReadonlySet<string>): ReadonlySet<string> {
  const bases = new Set<string>();
  for (const target of targets) {
    const cut = target.lastIndexOf('/');
    bases.add(cut < 0 ? '.' : target.slice(0, cut));
  }
  return bases;
}

/**
 * The directories a published ADR tool puts a decision base at, POSIX-spelled and relative
 * to the project root.
 *
 * WHERE EACH ONE COMES FROM, because a list with no provenance is a list that grows by
 * opinion: `doc/adr` is `adr-tools`' default, `docs/adr` is `log4brains`', `docs/decisions`
 * is MADR's, `docs/architecture/decisions` is the spelling Nygard's article put in
 * circulation, and `adr` at the root is what a project that wants it short writes. Every
 * entry is a directory some tool CREATES if you let it, which is the only test for
 * membership here — a directory this or any other project happens to use is not one.
 *
 * THIS BENCH'S OWN `.refactor/decisions` IS DELIBERATELY NOT IN IT, and the reason is the
 * rule rather than modesty: it is this repository's convention and no market's, so shipping
 * it would put a fact about how this product is built into what the product says to
 * everybody else. A project that keeps decisions somewhere unconventional is a project this
 * reading says nothing about, and that is the honest silence — `decision import <dir>`
 * takes any directory, and `--help` names it.
 *
 * THE LIST IS SHORT ON PURPOSE, because each entry costs a `readdirSync` on every
 * `mnema status`. Measured on 17/09/2026, medians of 200 rounds in alternated order with a
 * base-vs-base control that tied (0.174 against 0.173 ms): the five together cost
 * **0.175 ms** over a checkout whose `docs/decisions` holds 260 documents, and **0.045 ms**
 * over one where none of the five exists. The same `mnema status` costs **171 ms**, so the
 * whole reading is **0.10%** of the answer it rides on. A sixth entry is not free — it is
 * cheap, which is a different thing, and the number is what a later list is argued against.
 */
const CONVENTIONAL_BASES: readonly string[] = [
  'adr',
  'doc/adr',
  'docs/adr',
  'docs/architecture/decisions',
  'docs/decisions',
];

/** A conventional decision base this checkout holds, that the record has never read. */
export interface UnimportedBase {
  /** The directory, POSIX-spelled and relative to the project root — what a reader types back. */
  readonly directory: string;
  /**
   * How many decision documents it holds, by FILE NAME alone (`adrFileNames`).
   *
   * It is not how many would be proposed, and the difference is the same one
   * {@link DecisionsOutside.outside} carries: a document may still be refused as retired,
   * over the field limit, or holding something shaped like a credential. This counts what
   * a person would see on opening the directory, which is the number that makes the line
   * recognizable to them. The verb that decides is named beside it.
   *
   * Never zero on an entry that is reported: a conventional path that does not exist, or
   * that holds no decision document, is a path this says nothing about.
   */
  readonly documents: number;
}

/**
 * The conventional decision bases this checkout holds that the record has never read a
 * decision out of — in {@link CONVENTIONAL_BASES} order, and only those with documents in
 * them.
 *
 * WHY IT IS A SEPARATE ANSWER FROM {@link decisionsOutsideTheRecord} rather than a wider
 * one. That reading is about DRIFT: a base the record already knows, and the documents
 * added to it since. This one is about ARRIVAL: a repository where the gesture has never
 * been made at all, which is the case that reading is structurally unable to reach, because
 * its directories come out of edges that do not exist yet. A base the record names is
 * skipped here whatever its count, so the two never report one directory twice.
 *
 * `root` is the project root, the same one the other reading takes.
 */
export function basesNeverImported(
  sources: readonly ScopedCache[],
  root: string,
): UnimportedBase[] {
  const known = basesOf(importedTargets(sources));
  const found: UnimportedBase[] = [];
  for (const directory of CONVENTIONAL_BASES) {
    if (known.has(directory)) continue;
    const documents = adrFileNames(join(root, ...directory.split('/'))).length;
    if (documents > 0) found.push({ directory, documents });
  }
  return found;
}

/**
 * A file of `directory`, spelled the way the RECORD spells it — which is the only spelling
 * the lookup above can ask about.
 *
 * THE ROOT IS THE CASE THIS EXISTS FOR, and it was a defect before it was a function. A
 * project that keeps its decisions at the top of the repository is imported with
 * `mnema decision import .`, and the provenance recorded for each is a bare file name with
 * no directory in it. The base derived back from such a target is `.`, and a key built as
 * `${directory}/${name}` spelled it `./0001-utc.md` — which matches nothing, so every
 * document of that base counted as outside the record for ever. Measured: a root base with
 * one document imported and one written afterwards reported two outside instead of one.
 */
function inBase(directory: string, name: string): string {
  return directory === '.' ? name : `${directory}/${name}`;
}

/**
 * Whether a link's target is a path this checkout could hold, under the project root.
 *
 * A `derived-from` edge is a link like any other and a person may record one by hand,
 * so its target is whatever their command line sent: a record id, a URL, an absolute
 * path, a `..` walking out of the repository. This reading turns a target into a
 * directory it then LISTS, so the filter is a door and not a tidiness: what it lets
 * through is a relative POSIX path, with no segment that climbs, naming a markdown
 * file. Everything else is not a decision document of this project and is dropped
 * without a word — it is somebody else's use of an open relation, not a defect.
 */
function insideRoot(target: string): boolean {
  if (target.startsWith('/') || target.includes('\\') || /^[A-Za-z]:/.test(target)) return false;
  const segments = target.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  return /\.(?:md|markdown)$/i.test(target);
}
