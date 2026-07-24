/**
 * `mnema task move <action> <id>` — move a task through the workflow.
 *
 * This is the create command's sibling: the same adapter shape (resolve which
 * tree the write belongs to, open its writer, call ONE core operation through
 * the gate, report what it returned) applied to a state change instead of a
 * birth. It holds no workflow logic — it does not know the states, the legal
 * moves, or which action needs which proof. It forwards the action as a string
 * and the proof as fields; the gate inside {@link transitionTask} decides, and
 * an unknown action, an illegal move, or missing proof comes back as the gate's
 * own typed refusal for the CLI to print.
 *
 * The transition follows the ENTITY, not a fixed tree. A task lives in exactly
 * one tree (the one it was born in), and its move must land THERE — writing it
 * to a different tree would split the task's history across the public/private
 * boundary and leave whoever reads only one tree (the team, on the public tree)
 * with an incoherent view. So the command first LOCATES the task's home tree
 * ({@link locateEntityScope}) and opens THAT tree's writer, rather than assuming
 * the public one. If no visible tree holds the task, it refuses — you cannot
 * move what you cannot see.
 *
 * The task is named by its id (the value `task` create returned), not its alias:
 * an alias is a non-reversible display hash, so there is no alias→id lookup to
 * do here — resolving one would be domain logic this surface must not hold.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  deriveAlias,
  locateEntityScope,
  resolveTrees,
} from '@mnema/core';
import { openTreeForWriting, transitionTask } from '@mnema/core/write';

/** What the transition command needs — injected so it is testable. */
export interface TaskTransitionContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The proof a caller may carry for a move — the surface's view of the fields. */
export interface TaskTransitionProof {
  /** Why a task was canceled, blocked, or reopened. */
  readonly reason?: string;
  /** What was done when completing or approving. */
  readonly note?: string;
  /** What must change when review is not approved. */
  readonly feedback?: string;
}

/** A task moved to a new state. */
export interface TaskTransitioned {
  readonly ok: true;
  /** The task's id (the one that was moved). */
  readonly id: string;
  /** The short human-facing alias (`t-xxxx`), derived from the id. */
  readonly alias: string;
  /** The state the task is now in, resolved by the gate. */
  readonly to: string;
}

/** The move was refused. */
export type TaskTransitionRefused =
  /** There is no project here — a task lives in a project. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No visible tree holds this task — it cannot be moved from here. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_TASK' }
  /** The core operation refused (an unknown/illegal move, missing proof, …). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Moves a task in the tree it was born in. The transition follows the entity: it
 * locates which tree holds the task ({@link locateEntityScope}) and opens THAT
 * tree's writer, so the move never lands in a different tree than the birth and
 * never splits the history. With no `.mnema/` found from the cwd and no global
 * home for the task, this refuses `NO_PROJECT` (a human moves project work);
 * with a project present but the task in no visible tree, it refuses
 * `UNKNOWN_TASK` — you cannot move what you cannot see. The action and proof are
 * forwarded to the core untouched; whether the move is legal is the gate's call,
 * and its refusal is surfaced as `REFUSED` with the gate's own code and message.
 */
export function runTaskTransition(
  ctx: TaskTransitionContext,
  input: { id: string; action: string; proof?: TaskTransitionProof },
): TaskTransitioned | TaskTransitionRefused {
  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);

  // Find the tree the task lives in; the move must follow it there. When no tree
  // holds the task, distinguish "you are not in a project" (a human moves
  // project work) from "this project simply does not have that task".
  const scope = locateEntityScope(trees, input.id, upcasters);
  if (scope === undefined) {
    return trees.projectPublic === undefined
      ? { ok: false, reason: 'NO_PROJECT' }
      : { ok: false, reason: 'UNKNOWN_TASK' };
  }

  const writer = openTreeForWriting(trees, scope);
  const fields = proofToFields(input.proof);
  const moved = transitionTask(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters,
    },
    {
      id: input.id,
      action: input.action,
      ...(fields !== undefined ? { fields } : {}),
    },
  );
  if (!moved.ok) {
    return { ok: false, reason: 'REFUSED', code: moved.code, message: moved.message };
  }

  // Checkpoint so the transition is signature-covered at once — the same posture
  // create leaves the tree in.
  writer.checkpoint();

  return { ok: true, id: input.id, alias: deriveAlias('task', input.id), to: moved.to };
}

/**
 * Builds the chain's proof fields from the flags a caller supplied, dropping any
 * that were absent. Returns undefined when none were given, so a move that needs
 * no proof carries no `fields` at all — the gate then requires nothing. Only the
 * three textual proof fields the gate can ever require are surfaced; pr_url and
 * links are never proof and are not part of a transition here.
 */
function proofToFields(proof: TaskTransitionProof | undefined): TransitionFields | undefined {
  if (proof === undefined) return undefined;
  const fields: { reason?: string; note?: string; feedback?: string } = {};
  if (proof.reason !== undefined) fields.reason = proof.reason;
  if (proof.note !== undefined) fields.note = proof.note;
  if (proof.feedback !== undefined) fields.feedback = proof.feedback;
  return Object.keys(fields).length > 0 ? fields : undefined;
}
