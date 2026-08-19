/**
 * `mnema link <subject> <target> --rel <label>` — link one entity to another.
 *
 * The relational sibling of the knowledge verbs, and the last. Like the others
 * it is a point-in-time FACT — no gate, no state, no `move` — and it mints NO id:
 * a link is an edge, not an entity, so the command reports the FACT (subject,
 * relation, target), not an id.
 *
 * The `subject` and `target` are POSITIONAL (short ids), while the relation is a
 * FLAG (`--rel <label>`). The relation is an OPEN string, not a closed set: the
 * catalog's `RECOMMENDED_LINK_RELATIONS` are DOCUMENTATION, not enforcement — a
 * relation outside them is as valid as a new action, so the surface makes no enum
 * of it (an enum here would contradict the core). The help suggests the recommended
 * set, read from the catalog rather than repeated here; any string is accepted.
 *
 * Neither `subject` nor `target` is verified to exist. A link is legitimately
 * cross-tree — a private memory may point at a public task — and the writer sees
 * only its own tree, so the core does not refuse a dangling target and neither
 * does the surface. The reference is an asserted fact resolved on read.
 *
 * The birth scope is a per-action choice: an explicit `scope` wins; when omitted,
 * the KIND decides — a link asserts a relation between records of the project, so
 * it belongs to the tree that travels with them. A declared `which` names the agent
 * on the fact and does not move the tree.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { linkKnowledge, openTreeForWriting } from '@mnema/core/write';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';

/** What the link command needs — injected so it is testable. */
export interface LinkContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A link was recorded — the fact, with its references (there is no id). */
export interface LinkRecorded extends Replacement, Landed {
  readonly ok: true;
  /** The entity that ORIGINATES the link (the event subject). */
  readonly subject: string;
  /** What the link points at: another record's id, or a path under `governs`. */
  readonly target: string;
  /** The relation label (an open string). */
  readonly rel: string;
}

/** The record was refused. */
export type LinkRefused =
  /** There is no project here — a project-scoped link needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Records a knowledge link, routing its birth to the resolved scope. The scope
 * the one every birth follows: an explicit `scope` wins, else the tree the KIND
 * names (public). Both `subject` and `target` are forwarded to the core as-is and
 * never validated — a dangling target is honest cross-tree, never a refusal. The
 * `rel` is an open string, forwarded verbatim. On success it echoes the fact back
 * (subject, rel, target) — there is no minted id — plus the tree it landed in. A
 * declared `which` is recorded on the event and does not move the tree.
 */
export function runLink(
  ctx: LinkContext,
  input: {
    subject: string;
    target: string;
    rel: string;
    scope?: Scope;
    which?: string;
    run?: string;
  },
): LinkRecorded | LinkRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope('knowledge.linked', { which: input.which }, input.scope);
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const recorded = linkKnowledge(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    {
      subject: input.subject,
      target: input.target,
      rel: input.rel,
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!recorded.ok) {
    return { ok: false, reason: 'REFUSED', code: recorded.code, message: recorded.message };
  }

  // Checkpoint so the new link is signature-covered at once.
  writer.checkpoint();

  return {
    ok: true,
    subject: input.subject,
    target: input.target,
    // The relation AS RECORDED — screened, so the echo shows what landed.
    rel: recorded.rel,
    scope,
    ...forwardReplacement(recorded),
  };
}
