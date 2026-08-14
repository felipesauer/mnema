/**
 * `mnema exposure` — which records hold something shaped like a credential.
 *
 * The one read that is about the record's PAST rather than its content. The
 * content door defends what arrives; everything written before it existed was
 * written with no defense at all, and in a committed tree that past is what
 * decides the damage. So this answers "what is already in here?" without anyone
 * having to open every record by hand.
 *
 * It reports WHERE and never WHAT: the id, the kind, the tree, the instant and the
 * class. Not the value — not truncated, not partly masked, and not in `--json`. A
 * command that printed credentials would turn the remedy into a second disclosure
 * (a CI log, a scrollback, a screenshot), and the detector it calls returns classes
 * only, so there is nothing here to print by accident.
 *
 * Unlike the other intelligence reads it takes the trees SEPARATELY
 * ({@link scopedEvents}) rather than merged: a fact in the public tree is
 * committed and clones to every machine, and the same fact in the global tree is on
 * one disk. Same finding, different situation, and the merge is exactly what would
 * lose the difference.
 *
 * ONE PROJECT, and that is the shape of this READ rather than a limit left in place: it
 * runs in a directory, `cwd` resolves one project, and no second project is handed to
 * it. THE REASON USED TO BE ABOUT THE SURFACE — *"there is no workspace for it to
 * span"* — and `mnema verify --workspace` falsified that: a CLI verb spans a workspace
 * when the caller NAMES it, since the person is the announcer the MCP's host is. What
 * did not change is this reading: nothing names a set to it, and an exposure report is
 * about the record you are standing in. The MCP tool of the same name is opened by a
 * client that
 * announces several projects at once, so it reads every one of them and its answer
 * carries a project label and one denominator per record. Here the answer needs
 * neither — but it does have to SAY so, which is what the empty report's second line
 * does: a denominator beside an empty list otherwise reads as ground covered.
 *
 * Read-only: it reads the present trees' tails and folds them with the copilot's
 * pure `exposure`. No cache, no writer, no key, no actor. With no project it
 * refuses `NO_PROJECT`, like the other intelligence reads.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type Exposure, exposure } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { scopedEvents } from '../intelligence-source.js';

/** What the exposure command needs — injected so it is testable. */
export interface ExposureContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The report: which records hold a recognized credential format, and how many were read. */
export interface ExposureDone {
  readonly ok: true;
  readonly report: Exposure;
}

/** The read was refused — there is no project to inspect. */
export interface ExposureRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reports the records that hold a recognized credential format, across every tree
 * present here, oldest first. An empty report means nothing RECOGNIZABLE is there —
 * never that nothing is, which is the limit the detector states for itself.
 */
export function runExposure(ctx: ExposureContext): ExposureDone | ExposureRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return { ok: true, report: exposure(scopedEvents(trees, catalogUpcasters())) };
}
