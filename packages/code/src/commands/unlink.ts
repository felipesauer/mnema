/**
 * `mnema unlink <subject> <target> --rel <label> --reason "<why>"` — take a link back.
 *
 * A link is a point-in-time fact and cannot be edited: the record only grows. What it CAN be is
 * taken back, by a later signed fact that names the edge the way the link did and says why. The
 * link's own event stays in the record; what changes is that every reader of links — the rules
 * that govern a path, the opening of a session, the census of a write — stops seeing the edge
 * when nobody else asserts it.
 *
 * It names the edge exactly as `mnema link` takes it — two positionals and the `--rel` flag — and
 * resolves an `ADR-<n>` label on either end the way that verb does, so a link recorded by label is
 * taken back by the same label. It follows the link to the tree it was recorded in and takes no
 * `--scope`. Only the identity that recorded the link takes it back, with any key of it.
 */

import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, locateLinkScope, resolveTrees } from '@mnema/core';
import { openTreeForWriting, retractLink } from '@mnema/core/write';
import { resolveAddress } from '../label-as-address.js';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';

/** What the unlink command needs — injected so it is testable. */
export interface UnlinkContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** A link was taken back — the edge, as it was recorded (a link has no id). */
export interface LinkTakenBack extends Replacement, Landed {
  readonly ok: true;
  readonly subject: string;
  readonly target: string;
  readonly rel: string;
}

/** The retraction was refused. */
export type UnlinkRefused =
  /** No visible tree holds a link of that edge — inside a project, or outside one. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_LINK' | 'NO_PROJECT' }
  /** A label that names no decision or several, or the core's refusal: not the author, … */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** Retracts the link `subject —rel→ target` in the tree it was recorded in. */
export function runUnlink(
  ctx: UnlinkContext,
  input: {
    subject: string;
    target: string;
    rel: string;
    reason: string;
    which?: string;
    run?: string;
  },
): LinkTakenBack | UnlinkRefused {
  const subject = resolveAddress(ctx, input.subject);
  if (!subject.ok) return refused('AMBIGUOUS_LABEL', subject.message);
  const target = resolveAddress(ctx, input.target);
  if (!target.ok) return refused('AMBIGUOUS_LABEL', target.message);
  const edge = { subject: subject.id, target: target.id, rel: input.rel };

  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = locateLinkScope(trees, edge, upcasters);
  if (scope === undefined) {
    return { ok: false, reason: trees.projectPublic === undefined ? 'NO_PROJECT' : 'UNKNOWN_LINK' };
  }

  const writer = openTreeForWriting(trees, scope);
  const retracted = writer.exclusively(() => {
    const written = retractLink(
      { writer, layout: { root: chainRootForScope(trees, scope) as string }, upcasters },
      {
        ...edge,
        reason: input.reason,
        ...(input.which !== undefined ? { which: input.which } : {}),
        ...(input.run !== undefined ? { run: input.run } : {}),
      },
    );
    // Checkpoint so the retraction is signature-covered at once.
    if (written.ok) writer.checkpoint();
    return written;
  });
  if (!retracted.ok) return refused(retracted.code, retracted.message);

  return {
    ok: true,
    subject: retracted.subject,
    target: retracted.target,
    rel: retracted.rel,
    scope,
    ...forwardReplacement(retracted),
  };
}

/** A retraction refused before anything was written. */
function refused(code: string, message: string): UnlinkRefused {
  return { ok: false, reason: 'REFUSED', code, message };
}
