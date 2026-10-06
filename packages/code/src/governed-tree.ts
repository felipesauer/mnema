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
 * caller that reached for {@link governingRules}, {@link rulesInForceAt},
 * {@link asksForAPersonAt} or {@link refusesAWriteAt} directly is
 * what `the-rule-has-an-address.test.ts` refuses ("one place assembles a governs read"),
 * by the symbols rather than by a list of files.
 *
 * FOURTH DERIVATION, AND IT WALKS RATHER THAN PROBES. {@link reachOfAddress} answers the
 * question the other three do not: how much of the working tree an address covers, at the
 * moment somebody records one. Its walk is injected into the context package exactly as the probe
 * is, and it is assembled here for the same reason and one more — what counts as a file
 * of the project is a JUDGEMENT ({@link NOT_HAND_WRITTEN}), and a judgement made twice is
 * two bases for one fraction. The two write surfaces both come through it.
 *
 * The test named here used to be `one-place-assembles-a-governs-read.test.ts`, which
 * never existed under that name; the case lives in the file above. Corrected rather than
 * dropped, because a doc-comment that names a guard is how the next reader finds out
 * whether the claim above is checked.
 */

import {
  type Dirent,
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  type AddressReach,
  addressReach,
  asksForAPersonAt,
  type GovernanceQuery,
  type GoverningRules,
  governingRules,
  governsInForceEverywhere,
  type RulesAtPath,
  refusesAWriteAt,
  rulesInForceAt,
  type ScopedCache,
  type WalkOutcome,
} from '@mnema/context';
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
   * file. An MCP server's working directory is the host's choice rather than the
   * directory an agent's path was written from, so it resolves against the project
   * root instead.
   *
   * THIS USED TO SAY the host spawns the server "with an arbitrary cwd". Measured on
   * the one host that declares no workspace roots, it is the workspace root, and the
   * server now reads it — to find the PROJECT, for such a client and no other
   * (`mcp/context.ts`). That makes it evidence of where the host is working; it does
   * not make it the directory a relative path in a tool call was meant from, which is
   * the only question this field answers.
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
 * EVERY PLACE A PATH IS READ AT: as written, and — when a link leads somewhere else inside the
 * project ({@link realPathInside}) — where it really lands. The write gate and the readers below
 * take their places from here, so the reading never names fewer places than the gate applies.
 */
export function placesOfAPath(read: GovernedRead): string[] {
  const real = realPathInside(read);
  return real === undefined ? [read.path] : [read.path, real];
}

/** How many segments an address has, `.` (the whole project) being none: the order of specificity. */
const depthOf = (address: string): number =>
  address === '.' ? 0 : address.split('/').filter((part) => part !== '').length;

/** Several readings of one path as ONE list: each rule once, most specific first. */
function onceBySpecificity<T extends { readonly address?: string | undefined }>(
  lists: readonly (readonly T[])[],
  idOf: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of lists.flat()) {
    const key = `${idOf(item)}\0${item.address ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.sort(
    (a, b) =>
      depthOf(b.address ?? '.') - depthOf(a.address ?? '.') ||
      (a.address ?? '').localeCompare(b.address ?? '') ||
      idOf(a).localeCompare(idOf(b)),
  );
}

/**
 * The rules that govern a path, for a reader that asks (`mnema rules`): the reading at EVERY
 * place the path is read at ({@link placesOfAPath}) added together, each rule once. A reader
 * that said less than the write gate applies would be telling a person a write is free that the
 * gate refuses. The answer carries the path as written and compares it as written; the lists a
 * place does not change (stale, unresolved, what the project addresses at all) are the first's.
 */
export function readGoverningRulesWhereItLands(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): GoverningRules {
  const [first, ...others] = placesOfAPath(read).map((path) =>
    readGoverningRules(sources, { ...read, path }),
  ) as [GoverningRules, ...GoverningRules[]];
  if (others.length === 0) return first;
  const all = [first, ...others];
  const rules = onceBySpecificity(
    all.map((one) => one.rules),
    (rule) => rule.rule,
  );
  const asks = onceBySpecificity(
    all.map((one) => one.asks),
    (rule) => rule.rule,
  );
  const refuses = onceBySpecificity(
    all.map((one) => one.refuses),
    (rule) => rule.rule,
  );
  return {
    ...first,
    rules,
    asks,
    refuses,
    counts: {
      ...first.counts,
      matching: rules.length,
      asks: { ...first.counts.asks, matching: asks.length },
      refuses: { ...first.counts.refuses, matching: refuses.length },
    },
  };
}

/**
 * The rules in force at a path, for the reads that tell (`mnema why`, the push): the reading at
 * every place the path is read at, each rule once — the same addition, for the same reason, as
 * {@link readGoverningRulesWhereItLands}.
 */
export function readRulesInForceWhereItLands(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): RulesAtPath {
  const [first, ...others] = placesOfAPath(read).map((path) =>
    readRulesInForceAt(sources, { ...read, path }),
  ) as [RulesAtPath, ...RulesAtPath[]];
  if (others.length === 0) return first;
  return {
    ...first,
    rules: onceBySpecificity(
      [first, ...others].map((one) => one.rules),
      (rule) => rule.id,
    ),
  };
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
 * The same reading under the relation that REFUSES a write — what a refusal stands on.
 *
 * Its own entry point over the same {@link asked}, for the gate's reason: the path a write
 * was refused against must be the path `mnema rules` reports for it, to the byte.
 */
export function readRefusesAWriteAt(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): RulesAtPath {
  return refusesAWriteAt(sources, asked(read));
}

/**
 * Every address the rules in force hold under `governs` — the push's own reading, without the
 * path — what a rules file for another host is composed from (`commands/rules-file.ts`).
 *
 * FIFTH ENTRY POINT, SAME PROBE. It asks no path, so it does not go through {@link asked}; what
 * it shares with the others is the root and the disk probe, which is the part two surfaces
 * could come to disagree about, so it is written here and nowhere else.
 */
export function readGovernsInForceEverywhere(
  sources: readonly ScopedCache[],
  root: string,
): ReturnType<typeof governsInForceEverywhere> {
  return governsInForceEverywhere(sources, {
    root,
    onDisk: (relative) => existsSync(join(root, relative)),
  });
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

/** The directory `path` sits in, as the file system has it; the spelled one when it cannot be read. */
function realDirectoryOf(path: string): string {
  try {
    return realpathSync(dirname(path));
  } catch {
    return dirname(path);
  }
}

/** How many links one resolution follows by hand before it gives the path as given (the kernel's own 40). */
const MOST_LINKS_FOLLOWED = 40;

/**
 * Where a path really is, when that is somewhere else INSIDE the project — the one resolution
 * every write gate uses to match an address against a path a link may be hiding.
 *
 * A rule addressed at `src/ledger` is a rule about those bytes, and a host that names them
 * through a link (`alias.ts -> src/ledger/posting.ts`, or a new file under a directory that is
 * one) has not named a different file. The real path is the `realpath` of the file, or — when it
 * does not exist yet — of its nearest existing ancestor with the rest put back, so a file about
 * to be created is placed by where its directory really is. It answers an absolute path under
 * `read.root`, or `undefined` when there is nothing more to match: the path is already its own
 * real path, or the real one is outside the project, where no address can reach and the path as
 * given is all there is to match. Nothing here is ever asked to fail: an unreadable link is no
 * further evidence, and the path as given stands.
 */
export function realPathInside(read: GovernedRead): string | undefined {
  const given = resolve(read.from, read.path);
  let rootReal: string;
  try {
    rootReal = realpathSync(read.root);
  } catch {
    return undefined;
  }
  let existing = given;
  const rest: string[] = [];
  let hops = 0;
  for (;;) {
    // A LINK WHOSE TARGET DOES NOT EXIST YET is still where a write lands: `realpath` fails on
    // it, so it is followed by hand, its target read against the link's own directory. Past the
    // hop limit (a loop) the path as given is all there is to match.
    let target: string | undefined;
    try {
      if (lstatSync(existing).isSymbolicLink()) {
        hops += 1;
        if (hops > MOST_LINKS_FOLLOWED) return undefined;
        // A relative target is read from where the link REALLY is: the directory it sits in may
        // itself be a link, and `..` climbs out of the real one, not out of the spelling.
        target = resolve(realDirectoryOf(existing), readlinkSync(existing));
      }
    } catch {
      target = undefined;
    }
    if (target !== undefined) {
      existing = target;
      continue;
    }
    try {
      const real = join(realpathSync(existing), ...rest);
      const inside = relative(rootReal, real);
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined;
      const there = resolve(read.root, inside);
      return there === given ? undefined : there;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return undefined;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
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
 * {@link ADDRESS_RELATIONS}, so a third ADDRESS relation is answered here by existing.
 * A relation whose target is merely a path is not one: `derived-from` carries the file
 * a proposal was read out of, and there is no region under it to walk — which is why
 * this answers `undefined` for it, and why "the target looks like a path" was never the
 * question this asks.
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
