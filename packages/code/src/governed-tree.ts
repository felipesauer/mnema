/**
 * The one place an ADDRESS question is put together: the record's addresses, the
 * project root they are relative to, and the working tree — which says both which of
 * them still name something and how much of the tree one of them covers.
 *
 * Three surfaces ask the reading now — `mnema rules`, the MCP tool an agent calls, and
 * the tool the HOST calls before a file is written — and the derivations that answer it
 * take an injected disk probe, so each surface could have brought its own. Two probes is
 * two ideas of what "the address exists" means, and they would differ silently: the count
 * of stale rules would come back different depending on which surface asked, and neither
 * answer would say so. So the assembly lives here and every caller passes through it. A
 * caller that reached for {@link governingRules}, {@link rulesInForceAt} or
 * {@link asksForAPersonAt} directly is
 * what `the-rule-has-an-address.test.ts` refuses ("one place assembles a governs read"),
 * by the symbols rather than by a list of files.
 *
 * FOURTH DERIVATION, AND IT WALKS RATHER THAN PROBES. {@link reachOfAddress} answers the
 * question the other three do not: how much of the working tree an address covers, at the
 * moment somebody records one. Its walk is injected into the copilot exactly as the probe
 * is, and it is assembled here for the same reason and one more — what counts as a file
 * of the project is a JUDGEMENT ({@link NOT_HAND_WRITTEN}), and a judgement made twice is
 * two bases for one fraction. The two write surfaces both come through it.
 *
 * The test named here used to be `one-place-assembles-a-governs-read.test.ts`, which
 * never existed under that name; the case lives in the file above. Corrected rather than
 * dropped, because a doc-comment that names a guard is how the next reader finds out
 * whether the claim above is checked.
 */

import { type Dirent, existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  type AddressReach,
  addressReach,
  asksForAPersonAt,
  type GovernanceQuery,
  type GoverningRules,
  governingRules,
  type RulesAtPath,
  rulesInForceAt,
  type ScopedCache,
  type WalkOutcome,
} from '@mnema/copilot';
import { ADDRESS_RELATIONS } from '@mnema/core';

/**
 * What a `governs` read is asked: a path, the project it belongs to, and the
 * directory a RELATIVE path is written against.
 */
export interface GovernedRead {
  /** The path, as the caller wrote it — relative or absolute. */
  readonly path: string;
  /** The project's root directory — the parent of its `.mnema/`, absolute. */
  readonly root: string;
  /**
   * The directory a relative path is resolved against, and the one difference
   * between the two surfaces — named here rather than left implicit.
   *
   * The command line has a working directory and a person types a path against it,
   * so `mnema rules src/cli.ts` run inside `packages/code` means that package's
   * file. An MCP server is spawned with an arbitrary cwd by its host, so it has no
   * such directory to mean, and it resolves against the project root instead.
   */
  readonly from: string;
}

/**
 * Reads which rules of the record govern `read.path`, over the trees of the
 * project at `read.root` — every address it holds, with each rule's state beside it and
 * no judgement of any of them. What the question IS, including the disk probe, is
 * {@link asked}.
 */
export function readGoverningRules(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): GoverningRules {
  return governingRules(sources, asked(read));
}

/**
 * The same reading, narrowed to the rules that still hold — what a channel that PUSHES
 * carries.
 *
 * It goes through the same {@link asked} as the reading above, and that is the whole
 * reason it is here rather than at the surface that pushes: the address of a rule and the
 * probe that says whether it still names anything are one idea in this product, and a
 * pushed text disagreeing with `mnema rules` about which rules a file has would be the
 * two answers a shared assembly exists to prevent.
 */
export function readRulesInForceAt(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): RulesAtPath {
  return rulesInForceAt(sources, asked(read));
}

/**
 * The same reading again, under the relation that asks for a PERSON — what a channel that
 * STOPS somebody stands on.
 *
 * Third entry point, same {@link asked}, and the reason is one step sharper than it is for
 * the two above. A gate is decided by the same address comparison and the same disk probe
 * as the text; if this assembled its own question, the path a charge was decided against
 * could differ by a resolved link or a trailing slash from the path `mnema rules` reports —
 * and the person the difference trapped would have no reading that agreed with what
 * happened to them.
 */
export function readAsksForAPersonAt(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): RulesAtPath {
  return asksForAPersonAt(sources, asked(read));
}

/**
 * The question every path READING is asked: the path made absolute against the directory
 * the caller means, the root every address is relative to, and the probe. It said "both
 * readings" when there were two; there are three, and {@link reachOfAddress} is a fourth
 * derivation that asks a different question and so does not come through here.
 *
 * Written once because it is the assembly this module exists to hold. The probe is
 * `existsSync` against the project root, and the address it is handed is already reduced
 * to a POSIX path with no climbing left in it, so nothing here can be asked about a path
 * outside the project. The root itself arrives as `.`, which joins to the root and exists
 * by construction — a rule addressed at the whole repository is never stale.
 */
function asked(read: GovernedRead): GovernanceQuery {
  return {
    path: isAbsolute(read.path) ? read.path : join(read.from, read.path),
    root: read.root,
    onDisk: (relative) => existsSync(join(read.root, relative)),
  };
}

/**
 * The directories a reach count does NOT descend into, and the rule behind the list.
 *
 * A fraction is only as honest as its base, and there is no definition in this product
 * of "a file of the project" for the base to lean on — so one is taken HERE, in the
 * open, rather than left implicit in a walk nobody reads. Counting everything under the
 * root was the alternative and it is honest and useless: a checkout of dependencies is
 * regularly an order of magnitude larger than the work, so `node_modules` alone drowns
 * the signal and every address comes back covering a few percent of a number that means
 * nothing.
 *
 * ONE RULE PICKS THE NAMES: none of them is written by hand. `.git` is the version
 * control system's own record, `.mnema` is this product's, `node_modules` is somebody
 * else's code checked out here, and `dist`, `build` and `coverage` are output generated
 * from the work rather than the work. What a person edits stays in the base — `.github`
 * is a dotted directory and a hand-written one, so it counts.
 *
 * IT IS SHORT ON PURPOSE, and the shortness is the honest half. Every ecosystem has
 * more of these (`target`, `vendor`, `.venv`, `__pycache__`), and chasing them would
 * make this list a policy about other people's stacks that grows forever and is wrong
 * for whoever it forgot. So the list stays at the six that mean the same thing in any
 * repository, everything else lands in the base, and the surfaces NAME what was skipped
 * — which is what lets a reader who disagrees see the disagreement instead of a number.
 *
 * Held by `the-address-says-what-it-covers.test.ts`, which counts a tree with each of
 * these in it and asserts both the base and the names reported.
 */
export const NOT_HAND_WRITTEN = [
  '.git',
  '.mnema',
  'node_modules',
  'dist',
  'build',
  'coverage',
] as const;

/**
 * The most files one reach count walks before it stops.
 *
 * A ceiling exists because this runs inside a verb a person waits on, and an
 * unbounded recursive `readdir` over a tree somebody happens to have mounted is a verb
 * that hangs. The number is high enough that no ordinary repository reaches it — this
 * monorepo's own base is measured in the report — and reaching it is not silent: the
 * walk reports {@link WalkOutcome.truncated} and every surface says the counts are
 * floors. Cutting without saying so is a defect this product names in another front,
 * and it would be committing it here.
 */
export const WALK_CEILING = 50_000;

/**
 * What a recorded address covers in the working tree, or nothing when the relation
 * carries no address.
 *
 * THE ONE PLACE THE QUESTION IS ASSEMBLED, for the reason {@link asked} is: both write
 * surfaces — `mnema link` and the `link_knowledge` tool — report this, and a walk
 * brought by each would be two ideas of what the project's files ARE, so the same
 * address would come back covering two different fractions depending on which surface
 * recorded it. It also decides, once, WHICH relations have an address, off
 * {@link ADDRESS_RELATIONS}, so a third path relation is answered here by existing.
 *
 * It states a fact and stops: no threshold, no warning, no refusal. A wide address is a
 * legitimate thing to record and what was missing was never a policy — it was that the
 * person typing it could not see what it reached.
 */
export function reachOfAddress(
  rel: string,
  target: string,
  root: string,
  // The ceiling, defaulted to the real one and overridable so a case can actually
  // reach it: proving the walk stops requires a tree bigger than the ceiling, and a
  // case that wrote fifty thousand files is a case nobody runs. Both production
  // callers take the default, which is what `the-address-says-what-it-covers.test.ts`
  // asserts alongside the stop.
  ceiling: number = WALK_CEILING,
): AddressReach | undefined {
  if (!(ADDRESS_RELATIONS as readonly string[]).includes(rel)) return undefined;
  return addressReach({
    address: target,
    root,
    tree: { walk: (visit) => walkProject(root, visit, ceiling) },
  });
}

/**
 * Walks the project's files, calling `visit` with each project-relative POSIX path.
 *
 * Counts entries that are FILES and descends into entries that are DIRECTORIES, which
 * leaves a symlink neither counted nor followed. That is the cheap half of a real
 * decision: following one costs a `stat` per entry and buys a walk that can loop, and a
 * link counted as a file would count the same bytes twice under two addresses. So a
 * symlink is out of the base, in a module whose sibling probe deliberately DOES follow
 * one — `existsSync` is asked whether an address names something, and through a live
 * link it does.
 *
 * A directory it cannot read is skipped rather than thrown out of: a verb that recorded
 * the link successfully must not fail afterwards over a permission on a directory
 * nobody asked about, and the entry lands in `skipped` so the base still says so.
 */
function walkProject(
  root: string,
  visit: (relative: string) => void,
  ceiling: number,
): WalkOutcome {
  const skipped: string[] = [];
  let counted = 0;
  const descend = (dir: string, prefix: string): void => {
    // Named rather than inferred: `readdirSync`'s overloads resolve to the Buffer
    // one through a `ReturnType`, and every name below would come back as bytes.
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped.push(prefix === '' ? '.' : prefix);
      return;
    }
    for (const entry of entries) {
      // The ONE ceiling check, and it is here rather than also on entry because this
      // is the only place a directory is ever descended into: past the ceiling the
      // loop returns before deciding, so no deeper `readdirSync` happens. An entry
      // check was written first, with a comment claiming that without it "every
      // sibling above would still be opened and read"; a mutation that deleted it lit
      // NOTHING, which is what proved the claim false and the line dead. What the
      // ceiling actually bounds — directories OPENED, not just files counted — is
      // `the-walk-stops-at-its-ceiling.test.ts`.
      if (counted >= ceiling) return;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if ((NOT_HAND_WRITTEN as readonly string[]).includes(entry.name)) {
          skipped.push(entry.name);
          continue;
        }
        descend(join(dir, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      counted += 1;
      visit(relative);
    }
  };
  descend(root, '');
  return {
    // The names as MET, deduplicated: a monorepo holds one `node_modules` per package
    // and a reader wants to know which kinds of thing were left out, not how many
    // times each was. Sorted so the line does not change with directory order.
    skipped: [...new Set(skipped)].sort(),
    truncated: counted >= ceiling,
  };
}
