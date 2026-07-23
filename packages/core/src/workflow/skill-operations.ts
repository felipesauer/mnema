/**
 * The gated write operations for skills: the only way the core records a skill
 * or moves one, and the seam every surface goes through.
 *
 * They mirror the TASK operations — read current state from the chain (never the
 * cache), run the gate, append only if authorized — and are the simplest of the
 * three workflow entities: a skill is not relational, so there is no supersede,
 * no `by` existence check, and no frozen citation label. A skill is born with a
 * minted id and its `proposed` state; the four transitions (review, adopt,
 * reject, deprecate) each run through {@link skillGate} and append a
 * `skill.transitioned` only when the gate authorizes the move.
 */

import {
  type CatalogEvent,
  type ChainLayout,
  type ChainWriter,
  type Entry,
  skillBirth,
  skillTransitioned,
  type TransitionFields,
  type UpcasterRegistry,
} from '@mnema/chain';
import { canonicalId, mintId } from '../identity/id.js';
import { canonicalIdentity } from '../identity/who.js';
import { orderedEvents } from '../projections/order.js';
import { projectSkills, type SkillProjection } from '../projections/skill.js';
import { type Clock, systemClock } from './clock.js';
import { ensureFounded } from './identity-operations.js';
import { type SkillGateErr, skillGate } from './skill-gate.js';
import { INITIAL_SKILL_STATE } from './skill-states.js';

/** Shared dependencies for a write: where to read state from and where to append. */
export interface SkillWriteContext {
  readonly writer: ChainWriter;
  readonly layout: ChainLayout;
  readonly upcasters: UpcasterRegistry;
  /** The clock that stamps `at`; defaults to the wall clock. */
  readonly clock?: Clock;
}

/** A write refused before touching the chain. */
export type SkillWriteError =
  | SkillGateErr
  /** The skill acted on does not exist (no `skill.created` for this id). */
  | { readonly ok: false; readonly code: 'UNKNOWN_SKILL'; readonly message: string };

/** A skill was created: both birth events were appended, in order. */
export interface SkillCreateOk {
  readonly ok: true;
  /** The new skill's id (the event subject). */
  readonly id: string;
  /** The `skill.created` then the birth `skill.transitioned`, as appended. */
  readonly entries: readonly [Entry, Entry];
}

/** A skill transition was authorized and appended. */
export interface SkillTransitionOk {
  readonly ok: true;
  /** The state the skill is now in. */
  readonly to: string;
  /** The appended chain entry. */
  readonly entry: Entry;
}

/** What the caller asks to create. */
export interface SkillCreateInput {
  /** A short title for the pattern. */
  readonly name: string;
  /** The reusable pattern itself. */
  readonly body: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** What the caller asks for a skill transition. */
export interface SkillTransitionInput {
  /** The skill to move (the event subject). */
  readonly id: string;
  /** Proof and context for the move. */
  readonly fields?: TransitionFields;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Creates a skill: mints its id, then appends the birth pair (`skill.created`
 * then the birth `skill.transitioned`, `from: null` → proposed) atomically. The
 * id is minted by the operation, never supplied (see {@link mintId}). Birth is
 * not a gated transition — there is no prior state to judge — but it still
 * requires a human `who` who is not the executing agent, the same authority
 * invariant the gate enforces.
 */
export function createSkill(
  ctx: SkillWriteContext,
  input: SkillCreateInput,
): SkillCreateOk | SkillWriteError {
  // `who` is derived from the writer's key, always a real anchor; the only
  // authority check left is that the executing agent is not that identity.
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);
  if (which !== undefined && which === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }

  // The id is minted here, not chosen by the caller: derived from randomness so
  // two offline clones never mint the same one, closing false-merge of entities
  // at the root. It is canonical by construction.
  const id = mintId();

  // Found this installation's anchor before the birth pair, so both events'
  // signer is a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const birth = skillBirth(
    {
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    { name: input.name, body: input.body, initial: INITIAL_SKILL_STATE },
  );
  const [e1, e2] = ctx.writer.appendAll(birth) as [Entry, Entry];
  return { ok: true, id, entries: [e1, e2] };
}

/** Reviews a proposed skill (requires a note). */
export function reviewSkill(
  ctx: SkillWriteContext,
  input: SkillTransitionInput,
): SkillTransitionOk | SkillWriteError {
  return transition(ctx, 'review', input);
}

/** Adopts a reviewed skill as a live pattern (requires a note). */
export function adoptSkill(
  ctx: SkillWriteContext,
  input: SkillTransitionInput,
): SkillTransitionOk | SkillWriteError {
  return transition(ctx, 'adopt', input);
}

/** Rejects a proposed or reviewed skill (requires a note). */
export function rejectSkill(
  ctx: SkillWriteContext,
  input: SkillTransitionInput,
): SkillTransitionOk | SkillWriteError {
  return transition(ctx, 'reject', input);
}

/** Deprecates an adopted skill that fell out of use (requires a reason). */
export function deprecateSkill(
  ctx: SkillWriteContext,
  input: SkillTransitionInput,
): SkillTransitionOk | SkillWriteError {
  return transition(ctx, 'deprecate', input);
}

/**
 * The shared transition path: read the current state from the chain, run the
 * gate, and append only if it authorized the move. `to` and `action` both come
 * from the gate's verdict, never from the caller's assertion.
 */
function transition(
  ctx: SkillWriteContext,
  action: 'review' | 'adopt' | 'reject' | 'deprecate',
  input: SkillTransitionInput,
): SkillTransitionOk | SkillWriteError {
  // Canonicalize the subject id (NFC, the chain's stored form) so the lookup
  // keys on the same string the projection does.
  const id = canonicalId(input.id);
  const skills = projectedSkills(ctx);
  const current = id === undefined ? undefined : skills.get(id);
  if (id === undefined || current === undefined) {
    return { ok: false, code: 'UNKNOWN_SKILL', message: `skill "${input.id}" does not exist` };
  }

  // `who` is the writer's anchor, derived from its key, never supplied.
  const who = ctx.writer.anchor;
  const verdict = skillGate({
    from: current.state,
    action,
    ...(input.fields !== undefined ? { fields: input.fields } : {}),
    who,
    ...(input.which !== undefined ? { which: input.which } : {}),
  });
  if (!verdict.ok) return verdict;

  const which = canonicalIdentity(input.which);

  // Found this installation's anchor before the transition, so its signer is a
  // key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const event = skillTransitioned(
    {
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    {
      from: current.state,
      to: verdict.to,
      action: verdict.action,
      ...(verdict.fields !== undefined ? { fields: verdict.fields } : {}),
    },
  );
  const entry = ctx.writer.append(event);
  return { ok: true, to: verdict.to, entry };
}

/**
 * Projects the skills from the chain (the source of truth), not the cache, so
 * the state/existence checks are gated against what the chain actually proves.
 */
function projectedSkills(ctx: SkillWriteContext): Map<string, SkillProjection> {
  const events: readonly CatalogEvent[] = orderedEvents(ctx.layout, ctx.upcasters);
  return projectSkills(events);
}
