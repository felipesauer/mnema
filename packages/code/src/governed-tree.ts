/**
 * The one place a `governs` reading is put together: the record's addresses, the
 * project root they are relative to, and the working tree that says which of them
 * still name something.
 *
 * Two surfaces ask this question — `mnema rules` and the MCP tool an agent calls —
 * and the derivation that answers it takes an injected disk probe, so each surface
 * could have brought its own. Two probes is two ideas of what "the address exists"
 * means, and they would differ silently: the count of stale rules would come back
 * different depending on which surface asked, and neither answer would say so. So
 * the assembly lives here and both callers pass through it. A third caller that
 * reached for {@link governingRules} directly is what
 * `one-place-assembles-a-governs-read.test.ts` refuses.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { type GoverningRules, governingRules, type ScopedCache } from '@mnema/copilot';

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
 * project at `read.root`.
 *
 * The probe is `existsSync` against the project root, and the address it is handed
 * is already reduced to a POSIX path with no climbing left in it, so nothing here can
 * be asked about a path outside the project. The root itself arrives as `.`, which
 * joins to the root and exists by construction — a rule addressed at the whole
 * repository is never stale.
 */
export function readGoverningRules(
  sources: readonly ScopedCache[],
  read: GovernedRead,
): GoverningRules {
  return governingRules(sources, {
    path: isAbsolute(read.path) ? read.path : join(read.from, read.path),
    root: read.root,
    onDisk: (relative) => existsSync(join(read.root, relative)),
  });
}
