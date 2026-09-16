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
 * NOTHING HERE GUESSES WHICH DIRECTORY. `scanAdrDirectory`'s own rule is that the
 * caller names the base and the product never picks one, and this keeps it: the
 * directories come out of the RECORD. Every decision the import wrote carries a
 * `derived-from` edge to the file it came from, so a base this project has imported
 * from is a base the record itself names. A project that has never imported has no such
 * edge, and this answers nothing at all — which is the right answer rather than a
 * special case, and is the same shape as the reading that says what it did not look at.
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
  const imported = new Set<string>();
  for (const source of sources) {
    for (const edge of source.cache.linksByRelation(DERIVED_FROM_RELATION)) {
      if (insideRoot(edge.target)) imported.add(edge.target);
    }
  }

  const bases = new Set<string>();
  for (const target of imported) {
    const cut = target.lastIndexOf('/');
    bases.add(cut < 0 ? '.' : target.slice(0, cut));
  }

  const found: DecisionsOutside[] = [];
  for (const directory of [...bases].sort()) {
    const names = adrFileNames(join(root, ...directory.split('/')));
    const outside = names.filter((name) => !imported.has(inBase(directory, name))).length;
    if (outside > 0) found.push({ directory, outside });
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
