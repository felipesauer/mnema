/**
 * `mnema skills` — where each pattern came from.
 *
 * The audit of the one thing mnema serves as INSTRUCTION. A skill's body is read
 * into the prompt of every session that reaches the tree it was adopted in, and
 * two acts put it there: someone proposed it and someone adopted it. This is the
 * reading that shows both, for every pattern the record holds — including the ones
 * never adopted, because the curation backlog is part of where a pattern came from.
 *
 * IT HAS THE NAME OF AN MCP TOOL AND DOES SOMETHING ELSE, on purpose. The tool
 * serves the pattern to an agent that is about to work by it; this verb audits the
 * provenance for a person deciding whether it should be. That is the division the
 * product already draws — the MCP surface is the agent's, the command line is the
 * auditor's — and the `--help` says so out loud, because a reader has every reason
 * to assume the two are the same thing under two transports.
 *
 * It does NOT refuse outside a project, for the same reason `search` does not: a
 * pattern is a capability, and outside a project the global tree holds a person's
 * own conventions, which are a legitimate thing to audit from anywhere.
 *
 * Read-only in the strict sense: a cache per visible tree, rebuilt in memory, and
 * the copilot's pure `patternProvenance`. No writer, no key, no event — so no
 * `--actor`, and no consultation recorded (serving a body records one; auditing a
 * provenance is not serving it, and this read never touches a body at all).
 */

import { type PatternProvenance, patternProvenance } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { withScopedCaches } from '../tree-sources.js';

/** What the skills audit needs — injected so it is testable. */
export interface SkillsContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** Every pattern the visible trees hold, with the provenance of both acts. */
export interface SkillsDone {
  readonly ok: true;
  /** The patterns, ordered by name — empty when the record holds none. */
  readonly patterns: readonly PatternProvenance[];
}

/**
 * Reports every skill across the visible trees with who proposed it and who
 * adopted it. An empty record yields an empty list — a legitimate answer, never a
 * refusal.
 */
export function runSkills(ctx: SkillsContext): SkillsDone {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  return withScopedCaches(trees, (sources) => ({
    ok: true,
    patterns: patternProvenance(sources),
  }));
}
