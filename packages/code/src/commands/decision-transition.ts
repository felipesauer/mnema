/**
 * `mnema decision move <accept|reject> <id>` and `mnema decision supersede
 * <old-id> <new-id> --reason` — move a decision through its workflow.
 *
 * The decision counterpart of `task move`: the same adapter shape (locate the
 * tree the entity lives in, open its writer, call ONE core operation through the
 * gate, report what it returned) applied to a decision. It holds no workflow
 * logic — it does not know the states or which action needs which proof; it
 * forwards the action and the proof, and the gate inside the operation decides.
 *
 * The transition follows the ENTITY, not a fixed tree. A decision lives in one
 * tree (the one it was recorded in); its move must land THERE, or the history
 * would split across the public/private boundary. So this LOCATES the decision's
 * home tree ({@link locateEntityScope}) and opens THAT writer, never a scope the
 * caller picks — a transition takes no `--scope`.
 *
 * Supersede is not folded into the generic move. The core separates it in the
 * TYPES: `acceptDecision`/`rejectDecision` have no `by` channel, only
 * `supersedeDecision` does. So this runner routes by the action string —
 * accept/reject to their ops (which carry a `note`), supersede to its own (which
 * carries a `by` id and a `reason`). Passing a `by` to accept/reject is
 * impossible by the ops' shape; the runner forwards `by` only on supersede. On
 * the CLI the two shapes are two commands (a positional `by` the parser demands);
 * on the MCP they are one tool with an optional `by` — this runner serves both.
 *
 * A decision is named by its id (the value `decision` record returned), not an
 * alias: a decision HAS no alias — its human name is the `ADR-<n>` label, which
 * this resolves from the projection so the caller sees `ADR-7 → accepted`.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import {
  chainRootForScope,
  DECISION_ACTIONS,
  type DiscoveryEnv,
  locateEntityScope,
  orderedEvents,
  projectDecisions,
  resolveTrees,
} from '@mnema/core';
import {
  acceptDecision,
  openTreeForWriting,
  rejectDecision,
  supersedeDecision,
} from '@mnema/core/write';

/** What the transition command needs — injected so it is testable. */
export interface DecisionTransitionContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The proof a caller may carry for a decision move. */
export interface DecisionTransitionProof {
  /** Why this verdict — required by accept and reject. */
  readonly note?: string;
  /** Why the decision is being replaced — required by supersede. */
  readonly reason?: string;
}

/** A decision moved to a new state. */
export interface DecisionTransitioned {
  readonly ok: true;
  /** The decision's id (the one that moved). */
  readonly id: string;
  /** The decision's citable `ADR-<n>` label, resolved from the projection. */
  readonly adr: string;
  /** The state the decision is now in, resolved by the gate. */
  readonly to: string;
}

/** The move was refused. */
export type DecisionTransitionRefused =
  /** There is no project here — a decision lives in a project. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No visible tree holds this decision — it cannot be moved from here. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_DECISION' }
  /** The core operation refused (an illegal move, missing proof, a bad `by`, …). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Moves a decision in the tree it was recorded in. Locates the home tree
 * ({@link locateEntityScope}) and opens THAT writer, so the move follows the
 * entity and never splits the history. With no `.mnema/` found and no global home
 * this refuses `NO_PROJECT`; with a project present but the decision in no visible
 * tree, `UNKNOWN_DECISION`.
 *
 * The action string routes to the operation: `accept`/`reject` carry the `note`;
 * `supersede` carries the `by` (the successor id) and the `reason`. `by` is
 * forwarded ONLY on supersede — the other ops have no channel for it. Any other
 * action (or one the gate rejects) comes back as `REFUSED` with the gate's own
 * code and message; the surface never validates the action itself.
 */
export function runDecisionTransition(
  ctx: DecisionTransitionContext,
  input: { id: string; action: string; by?: string; proof?: DecisionTransitionProof },
): DecisionTransitioned | DecisionTransitionRefused {
  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);

  // Find the tree the decision lives in; the move must follow it there. When no
  // tree holds it, distinguish "you are not in a project" from "this project has
  // no such decision".
  const scope = locateEntityScope(trees, input.id, upcasters);
  if (scope === undefined) {
    return trees.projectPublic === undefined
      ? { ok: false, reason: 'NO_PROJECT' }
      : { ok: false, reason: 'UNKNOWN_DECISION' };
  }

  const root = chainRootForScope(trees, scope) as string;
  const writer = openTreeForWriting(trees, scope);
  const opCtx = { writer, layout: { root }, upcasters };
  const fields = proofToFields(input.proof);

  // Route the action to its typed operation. Unlike a task — where one generic
  // `transitionTask(action)` lets the gate be the sole validator — a decision's
  // operations are split by action IN THE CORE'S TYPES (accept/reject carry no
  // `by`, only supersede does), so the surface must dispatch on the action to
  // pick the right op. That dispatch needs the closed set of verbs
  // (`DECISION_ACTIONS`) — the vocabulary, NOT the transition table (from → to →
  // proof, which stays the gate's alone). An action outside that set is refused
  // UNKNOWN_ACTION here, the same code the gate raises, rather than silently
  // falling through to some default op.
  if (!(DECISION_ACTIONS as readonly string[]).includes(input.action)) {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'UNKNOWN_ACTION',
      message: `"${input.action}" is not a decision action`,
    };
  }
  const moved =
    input.action === 'supersede'
      ? supersedeDecision(opCtx, {
          id: input.id,
          // A missing `by` becomes '', which the gate reads as no successor and
          // refuses MISSING_BY — the honest refusal. The CLI's supersede verb
          // makes `by` a required positional so this only bites the MCP tool,
          // where `by` is optional and its absence on a supersede is a caller
          // error the gate reports.
          by: input.by ?? '',
          ...(fields !== undefined ? { fields } : {}),
        })
      : input.action === 'reject'
        ? rejectDecision(opCtx, {
            id: input.id,
            ...(fields !== undefined ? { fields } : {}),
          })
        : acceptDecision(opCtx, {
            id: input.id,
            ...(fields !== undefined ? { fields } : {}),
          });
  if (!moved.ok) {
    return { ok: false, reason: 'REFUSED', code: moved.code, message: moved.message };
  }

  // Checkpoint so the transition is signature-covered at once.
  writer.checkpoint();

  // Resolve the ADR from the projection: a decision has no alias, so its human
  // name is the frozen `ADR-<n>` label. Read after the append so the projection
  // reflects the move that just landed.
  const adr = projectDecisions(orderedEvents({ root }, upcasters)).get(input.id)?.adr ?? input.id;
  return { ok: true, id: input.id, adr, to: moved.to };
}

/**
 * Builds the chain's proof fields from the flags a caller supplied, dropping any
 * that were absent. Returns undefined when none were given. Only the two proof
 * fields a decision action can require are surfaced: `note` (accept/reject) and
 * `reason` (supersede).
 */
function proofToFields(proof: DecisionTransitionProof | undefined): TransitionFields | undefined {
  if (proof === undefined) return undefined;
  const fields: { note?: string; reason?: string } = {};
  if (proof.note !== undefined) fields.note = proof.note;
  if (proof.reason !== undefined) fields.reason = proof.reason;
  return Object.keys(fields).length > 0 ? fields : undefined;
}
