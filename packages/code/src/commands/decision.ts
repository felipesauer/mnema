/**
 * `mnema decision <title> <rationale>` — record a decision.
 *
 * A sibling of `task` create, differing only in what a decision needs. It is the
 * same adapter shape (resolve which tree the write belongs to, open its writer,
 * call ONE core operation through the gate, report what it returned) and holds no
 * domain logic — the id is minted by {@link recordDecision}, the `ADR-<n>` label
 * is frozen by it, the scope is the core's routing rule.
 *
 * Two things set a decision apart from a task, both reflected here:
 *
 *   1. A decision is born with BOTH a `title` and a `rationale` — the core
 *      requires both, so both are surfaced as required inputs (positional on the
 *      CLI, so a missing one is the parser's clear error, not a late gate error).
 *      What it turned down (`alternatives`) is optional and travels the same path:
 *      forwarded when the caller gave one, omitted when it did not, so a decision
 *      with no contender records no key for one.
 *
 *   2. A decision has NO alias. Its human-facing identifier is the `ADR-<n>`
 *      label the operation freezes into the record — a citation, not a hash of
 *      the id. So this returns the `adr`, never a derived alias.
 *
 * The birth scope is a per-action choice, exactly as for a task: an explicit
 * `scope` wins; when omitted, the KIND decides, and a decision is the most
 * team-facing artifact this product has — it goes to the tree that travels. An
 * agent operating the CLI declares itself (`which`), which names the agent on the
 * fact and no longer moves the tree.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { openTreeForWriting, recordDecision } from '@mnema/core/write';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';

/** What the decision command needs — injected so it is testable. */
export interface DecisionContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A decision was recorded. */
export interface DecisionRecorded extends Replacement, Landed {
  readonly ok: true;
  /** The minted decision id (the event subject). */
  readonly id: string;
  /** The citable `ADR-<n>` label frozen into the record — a decision's human name. */
  readonly adr: string;
}

/** The record was refused. */
export type DecisionRefused =
  /** There is no project here — a decision is project work and needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Records a decision, routing its birth to the resolved scope. The scope rule is
 * identical to a task's: an explicit `scope` wins, else the tree the KIND names
 * (public) — `resolveScope` is the single source of that rule. A PROJECT scope
 * (public/private) needs a project; with no `.mnema/` found from the cwd this
 * refuses `NO_PROJECT` rather than falling through. The GLOBAL scope needs none,
 * so `--scope global` works anywhere; the guard is on the RESOLVED scope, not the
 * flag.
 *
 * A declared `which` (an agent operating the CLI) is recorded on the event and
 * does not move the tree. The resolved scope comes back on the result.
 */
export function runDecision(
  ctx: DecisionContext,
  input: {
    title: string;
    rationale: string;
    alternatives?: string;
    scope?: Scope;
    which?: string;
    run?: string;
  },
): DecisionRecorded | DecisionRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope('decision.recorded', { which: input.which }, input.scope);
  // A project scope needs a project; global does not. Guard the resolved scope,
  // not the flag, so an omitted flag (default public) outside a project refuses
  // just as an explicit `--scope public` would.
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const recorded = recordDecision(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    {
      title: input.title,
      rationale: input.rationale,
      ...(input.alternatives !== undefined ? { alternatives: input.alternatives } : {}),
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!recorded.ok) {
    return { ok: false, reason: 'REFUSED', code: recorded.code, message: recorded.message };
  }

  // Checkpoint so the new decision is signature-covered at once — the tree stays
  // fully signed after every command, the same posture init leaves it in.
  writer.checkpoint();

  return { ok: true, id: recorded.id, adr: recorded.adr, scope, ...forwardReplacement(recorded) };
}
