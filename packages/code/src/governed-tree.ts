/**
 * The one place a `governs` reading is put together: the record's addresses, the
 * project root they are relative to, and the working tree that says which of them
 * still name something.
 *
 * Three surfaces ask this question now — `mnema rules`, the MCP tool an agent calls, and
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
 * The test named here used to be `one-place-assembles-a-governs-read.test.ts`, which
 * never existed under that name; the case lives in the file above. Corrected rather than
 * dropped, because a doc-comment that names a guard is how the next reader finds out
 * whether the claim above is checked.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  asksForAPersonAt,
  type GovernanceQuery,
  type GoverningRules,
  governingRules,
  type RulesAtPath,
  rulesInForceAt,
  type ScopedCache,
} from '@mnema/copilot';

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
 * The question both readings are asked: the path made absolute against the directory
 * the caller means, the root every address is relative to, and the probe.
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
