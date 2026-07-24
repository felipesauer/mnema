/**
 * `mnema skill "<name>" --body "<text>"` — propose a reusable pattern.
 *
 * A sibling of `task` and `decision` create, differing only in what a skill
 * needs. It is the same adapter shape (resolve which tree the write belongs to,
 * open its writer, call ONE core operation through the gate, report what it
 * returned) and holds no domain logic — the id is minted by {@link createSkill},
 * the scope is the core's routing rule.
 *
 * Two things set a skill apart, both reflected here:
 *
 *   1. A skill is born with BOTH a `name` and a `body` — the name is a short
 *      title, the body is the reusable pattern itself (often multi-line). The
 *      name is a positional; the body is a required flag (`--body`), the way
 *      `git commit -m` / `gh --body` take content that is too large for a
 *      positional. A missing `--body` is a usage error on the surface, so nothing
 *      is born — the same posture as a missing rationale on a decision.
 *
 *   2. A skill has NO alias and NO citation label. Its canonical identifier is
 *      the minted `id`; the `name` is DISPLAY only (not unique — two skills may
 *      share a name). So this returns both `id` (the key a caller copies to move
 *      it) and `name` (which orients the human), and never a derived alias.
 *
 * The birth scope is a per-action choice, exactly as for a task or a decision:
 * an explicit `scope` wins; when omitted, the routing rule's default stands
 * (public, a deliberate human capture). That omitted default is PROVISIONAL —
 * the mechanism (the override on top) is what is settled here.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { createSkill, openTreeForWriting } from '@mnema/core/write';

/** What the skill command needs — injected so it is testable. */
export interface SkillContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A skill was proposed. */
export interface SkillCreated {
  readonly ok: true;
  /** The minted skill id — the canonical identifier, the key a move takes. */
  readonly id: string;
  /** The skill's short name — DISPLAY only, not a key (not unique). */
  readonly name: string;
}

/** The create was refused. */
export type SkillRefused =
  /** There is no project here — a skill is project knowledge and needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Creates a skill, routing its birth to the resolved scope. The scope rule is
 * identical to a task's and a decision's: an explicit `scope` wins, else the
 * routing default (public) — `resolveScope` is the single source of that rule. A
 * PROJECT scope (public/private) needs a project; with no `.mnema/` found from
 * the cwd this refuses `NO_PROJECT` rather than falling through. The GLOBAL scope
 * needs none, so `--scope global` works anywhere; the guard is on the RESOLVED
 * scope, not the flag.
 */
export function runSkill(
  ctx: SkillContext,
  input: { name: string; body: string; scope?: Scope },
): SkillCreated | SkillRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope({}, input.scope);
  // A project scope needs a project; global does not. Guard the resolved scope,
  // not the flag, so an omitted flag (default public) outside a project refuses
  // just as an explicit `--scope public` would.
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const created = createSkill(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    { name: input.name, body: input.body },
  );
  if (!created.ok) {
    return { ok: false, reason: 'REFUSED', code: created.code, message: created.message };
  }

  // Checkpoint so the new skill is signature-covered at once — the tree stays
  // fully signed after every command, the same posture init leaves it in.
  writer.checkpoint();

  return { ok: true, id: created.id, name: input.name };
}
