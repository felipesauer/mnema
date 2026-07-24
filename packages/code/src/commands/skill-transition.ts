/**
 * `mnema skill move <action> <id>` — move a skill through its workflow.
 *
 * The skill counterpart of `task move`: the same adapter shape (locate the tree
 * the entity lives in, open its writer, call ONE core operation through the gate,
 * report what it returned) applied to a skill. It holds no workflow logic — it
 * does not know the states or which action needs which proof; the gate inside the
 * operation decides, and an illegal move or missing proof comes back as the
 * gate's own typed refusal.
 *
 * The transition follows the ENTITY, not a fixed tree. A skill lives in one tree
 * (the one it was proposed in); its move must land THERE, or the history would
 * split across the public/private boundary. So this LOCATES the skill's home tree
 * ({@link locateEntityScope}) and opens THAT writer, never a scope the caller
 * picks — a transition takes no `--scope`.
 *
 * Unlike a task — where one generic `transitionTask(action)` lets the gate be the
 * sole validator — a skill's four moves are FOUR NAMED operations in the core
 * (reviewSkill/adoptSkill/rejectSkill/deprecateSkill), so the surface must
 * dispatch on the action to pick the right op. That dispatch needs the closed set
 * of verbs (`SKILL_ACTIONS`) — the vocabulary, NOT the transition table (from →
 * to → proof, which stays the gate's alone). An action outside that set is
 * refused `UNKNOWN_ACTION` here, before touching any op, rather than falling
 * through to a default — none of the four is a silent fallback. Unlike a
 * decision's supersede, NO action carries a `by`: a skill is not relational
 * (replacing one skill with another is a `knowledge.linked`, not a move here).
 *
 * A skill is named by its id (the value `skill` create returned), not an alias: a
 * skill HAS no alias, and its `name` is not unique, so the move takes only the id.
 * The report resolves the `name` from the projection to orient the human, falling
 * back to the id if the projection has none.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  locateEntityScope,
  orderedEvents,
  projectSkills,
  resolveTrees,
  SKILL_ACTIONS,
} from '@mnema/core';
import {
  adoptSkill,
  deprecateSkill,
  openTreeForWriting,
  rejectSkill,
  reviewSkill,
} from '@mnema/core/write';

/** What the transition command needs — injected so it is testable. */
export interface SkillTransitionContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The proof a caller may carry for a skill move. */
export interface SkillTransitionProof {
  /** Why this verdict — required by review, adopt, and reject. */
  readonly note?: string;
  /** Why the skill fell out of use — required by deprecate. */
  readonly reason?: string;
}

/** A skill moved to a new state. */
export interface SkillTransitioned {
  readonly ok: true;
  /** The skill's id (the one that moved). */
  readonly id: string;
  /** The skill's short name, resolved from the projection (DISPLAY only). */
  readonly name: string;
  /** The state the skill is now in, resolved by the gate. */
  readonly to: string;
}

/** The move was refused. */
export type SkillTransitionRefused =
  /** There is no project here — a skill lives in a project. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No visible tree holds this skill — it cannot be moved from here. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_SKILL' }
  /** The core operation refused (an illegal move, missing proof, …). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Moves a skill in the tree it was proposed in. Locates the home tree
 * ({@link locateEntityScope}) and opens THAT writer, so the move follows the
 * entity and never splits the history. With no `.mnema/` found and no global home
 * this refuses `NO_PROJECT`; with a project present but the skill in no visible
 * tree, `UNKNOWN_SKILL`.
 *
 * The action string routes to the named operation — review/adopt/reject carry a
 * `note`, deprecate carries a `reason`. An action outside `SKILL_ACTIONS` is
 * refused `UNKNOWN_ACTION` before any op is called; a legal verb the gate then
 * rejects (illegal move, missing proof) comes back as `REFUSED` with the gate's
 * own code and message.
 */
export function runSkillTransition(
  ctx: SkillTransitionContext,
  input: { id: string; action: string; proof?: SkillTransitionProof },
): SkillTransitioned | SkillTransitionRefused {
  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);

  // Find the tree the skill lives in; the move must follow it there. When no tree
  // holds it, distinguish "you are not in a project" from "this project has no
  // such skill".
  const scope = locateEntityScope(trees, input.id, upcasters);
  if (scope === undefined) {
    return trees.projectPublic === undefined
      ? { ok: false, reason: 'NO_PROJECT' }
      : { ok: false, reason: 'UNKNOWN_SKILL' };
  }

  // Dispatch on the action to pick the right named op. An action outside the
  // closed vocabulary is refused UNKNOWN_ACTION here — never a fall-through to a
  // default op. The transition table itself (which move is legal, which proof it
  // needs) stays the gate's.
  if (!(SKILL_ACTIONS as readonly string[]).includes(input.action)) {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'UNKNOWN_ACTION',
      message: `"${input.action}" is not a skill action`,
    };
  }

  const root = chainRootForScope(trees, scope) as string;
  const writer = openTreeForWriting(trees, scope);
  const opCtx = { writer, layout: { root }, upcasters };
  const fields = proofToFields(input.proof);
  const args = { id: input.id, ...(fields !== undefined ? { fields } : {}) };
  const moved =
    input.action === 'review'
      ? reviewSkill(opCtx, args)
      : input.action === 'adopt'
        ? adoptSkill(opCtx, args)
        : input.action === 'reject'
          ? rejectSkill(opCtx, args)
          : deprecateSkill(opCtx, args);
  if (!moved.ok) {
    return { ok: false, reason: 'REFUSED', code: moved.code, message: moved.message };
  }

  // Checkpoint so the transition is signature-covered at once.
  writer.checkpoint();

  // Resolve the name from the projection to orient the human — a skill has no
  // alias, so its display handle is the name. Read after the append so the
  // projection reflects the move that just landed; fall back to the id if absent.
  const name = projectSkills(orderedEvents({ root }, upcasters)).get(input.id)?.name ?? input.id;
  return { ok: true, id: input.id, name, to: moved.to };
}

/**
 * Builds the chain's proof fields from the flags a caller supplied, dropping any
 * that were absent. Returns undefined when none were given. Only the two proof
 * fields a skill action can require are surfaced: `note` (review/adopt/reject)
 * and `reason` (deprecate).
 */
function proofToFields(proof: SkillTransitionProof | undefined): TransitionFields | undefined {
  if (proof === undefined) return undefined;
  const fields: { note?: string; reason?: string } = {};
  if (proof.note !== undefined) fields.note = proof.note;
  if (proof.reason !== undefined) fields.reason = proof.reason;
  return Object.keys(fields).length > 0 ? fields : undefined;
}
