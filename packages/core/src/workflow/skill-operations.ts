/**
 * The write operations for skills: the only way the core records a skill, moves
 * one, or notes that one was read, and the seam every surface goes through.
 *
 * The LIFECYCLE writes mirror the TASK operations — read current state from the
 * chain (never the cache), run the gate, append only if authorized — and are the
 * simplest of the three workflow entities: a skill is not relational, so there
 * is no supersede, no `by` existence check, and no frozen citation label. A
 * skill is born with a minted id and its `proposed` state; the four transitions
 * (review, adopt, reject, deprecate) each run through {@link skillGate} and
 * append a `skill.transitioned` only when the gate authorizes the move.
 *
 * {@link recordConsultation} is the one write here that is NOT a transition, and
 * so runs no gate. It records that a skill's body was served to someone — a
 * point-in-time fact about a skill, not a move of it. There is no prior state to
 * judge and nothing to authorize about a fact that will never move, which is
 * exactly the shape the knowledge facts have (`recordHandoff` is its twin: the
 * subject IS the referenced entity, no id is minted, and the whole result is
 * "it landed"). What still applies is the authority invariant, because that
 * defends the proof and not the workflow.
 */

import {
  type CatalogEvent,
  type ChainLayout,
  type ChainWriter,
  type Entry,
  skillBirth,
  skillConsulted,
  skillTransitioned,
  type TransitionFields,
  type UpcasterRegistry,
} from '@mnema/chain';
import {
  type ContentTooLargeErr,
  type ScreenedWrite,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { canonicalId, mintId } from '../identity/id.js';
import { oneLine } from '../one-line.js';
import { orderedEvents } from '../projections/order.js';
import { projectSkills, type SkillProjection } from '../projections/skill.js';
import { appendEvent, appendEvents, type UnreadableEventErr } from './append.js';
import { type Clock, systemClock } from './clock.js';
import { authorizingAnchor, ensureFounded } from './identity-operations.js';
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
  /** A free-text field was over the size limit (see {@link screenContent}). */
  | ContentTooLargeErr
  /** A read would not have accepted the event (see {@link appendEvent}). */
  | UnreadableEventErr
  /** The skill acted on does not exist (no `skill.created` for this id). */
  | { readonly ok: false; readonly code: 'UNKNOWN_SKILL'; readonly message: string };

/** A skill was created: both birth events were appended, in order. */
export interface SkillCreateOk extends ScreenedWrite {
  readonly ok: true;
  /** The new skill's id (the event subject). */
  readonly id: string;
  /**
   * The name AS RECORDED — screened, so a surface that echoes it (a skill has no
   * alias, so the name is how a human is told which one landed) shows what the
   * chain holds rather than what was asked for.
   */
  readonly name: string;
  /** The `skill.created` then the birth `skill.transitioned`, as appended. */
  readonly entries: readonly [Entry, Entry];
}

/** A skill transition was authorized and appended. */
export interface SkillTransitionOk extends ScreenedWrite {
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
  // The body is the largest text any write here carries — a whole recipe or
  // checklist — so it is both the field most likely to hold a worked example with
  // real values in it and the one the size limit is really about.
  // The pinned run joins them: it is the envelope's second caller-supplied field
  // and nothing here proves it names a session, so it goes through the same door.
  const text = screenContent({ name: input.name, body: input.body, run: input.run });
  if (!text.ok) return text;

  // `who` is derived from local material and the record, always a real anchor;
  // the only authority check left is that the executing agent is not that identity.
  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

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
      ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
    },
    { name: text.fields.name, body: text.fields.body, initial: INITIAL_SKILL_STATE },
  );
  const appended = appendEvents(ctx.writer, birth);
  if (!appended.ok) return appended;
  const [e1, e2] = appended.entries as [Entry, Entry];
  return {
    ok: true,
    id,
    name: text.fields.name,
    entries: [e1, e2],
    ...screened([...text.replaced, ...agent.replaced]),
  };
}

/** A consultation was recorded: the fact was appended. */
export interface ConsultationOk extends ScreenedWrite {
  readonly ok: true;
}

/** What the caller asks to record as a consultation. */
export interface ConsultationInput {
  /** The skill whose body was served (the event subject). */
  readonly skill: string;
  /** The agent that read it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any — what ties the consultation to a session. */
  readonly run?: string;
}

/**
 * Records that a skill was consulted: appends one `skill.consulted` fact whose
 * subject IS the skill. No id is minted (a consultation has no standalone
 * identity; it is an entry in the skill's history) and no gate runs (nothing
 * moved). The whole fact is the envelope — which skill, who authorized, which
 * agent read it, in what run, when — so there is no payload to build.
 *
 * The skill is NOT verified to exist, for the same two reasons the knowledge
 * facts forward their references unchecked. It is legitimately CROSS-TREE: a
 * private consultation may name a skill the team adopted in the public tree, and
 * this writer sees only its own tree, so a lookup here would refuse the common
 * case. And the caller that emits this has just READ the skill it names — the
 * body it served is the evidence the skill exists — so a re-projection of the
 * chain would buy nothing but a full replay on a read path.
 *
 * What it does NOT record is whether the pattern was FOLLOWED. That is not
 * observable from serving a body, and a field claiming it would be an assertion
 * the record cannot back.
 *
 * It carries no prose, but it does go through the content door, because the id it
 * names becomes the event's SUBJECT and is never validated — so it is a field
 * through which an unbounded value could reach the chain, and a fat event is what
 * the size limit exists to keep out. The refusal is unreachable from any surface
 * (the caller has just READ the skill it names, so the id came from a projection),
 * and the check is here for the reason the authority invariant is checked where it
 * always holds: an invariant enforced only where someone remembered it is a habit,
 * not a property.
 */
export function recordConsultation(
  ctx: SkillWriteContext,
  input: ConsultationInput,
): ConsultationOk | SelfAuthorizedErr | ContentTooLargeErr | UnreadableEventErr {
  // Both of its caller-supplied strings in one screen: the skill id that becomes
  // the SUBJECT, and the run that pins the fact to a session. Neither is proved
  // here, so both are fields through which an unbounded — or dirty — value could
  // reach the chain.
  const named = screenContent({ skill: input.skill, run: input.run });
  if (!named.ok) return named;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;
  // A REFERENCE to an already-minted id: canonicalized (NFC, the chain's stored
  // form) so a reader keys on the same string, but never minted here. It runs after
  // the screen so the canonicalization is bounded by the size limit.
  const skill = canonicalId(named.fields.skill) ?? named.fields.skill;

  // Found this installation's anchor before the fact, so its signer is a key
  // valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const appended = appendEvent(
    ctx.writer,
    skillConsulted({
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: skill,
      ...(which !== undefined ? { which } : {}),
      ...(named.fields.run !== undefined ? { run: named.fields.run } : {}),
    }),
  );
  if (!appended.ok) return appended;
  // It reports what was replaced like every other write, even though its own two
  // fields cannot realistically hold anything: the agent name CAN, it is stamped on
  // this fact as much as on any other, and a write that scrubbed in silence is the
  // one failure the report exists to make impossible.
  return { ok: true, ...screened([...named.replaced, ...agent.replaced]) };
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
 *
 * The proof is screened ahead of the gate for the reason the task's is: the gate
 * forwards its verdict's `fields` into the appended event.
 */
function transition(
  ctx: SkillWriteContext,
  action: 'review' | 'adopt' | 'reject' | 'deprecate',
  input: SkillTransitionInput,
): SkillTransitionOk | SkillWriteError {
  const proof =
    input.fields === undefined ? undefined : screenContent<TransitionFields>(input.fields);
  if (proof !== undefined && !proof.ok) return proof;

  // The pinned run through the same door, in its own call because the proof's is
  // conditional and a move with no proof still carries a run.
  const pinned = screenContent({ run: input.run });
  if (!pinned.ok) return pinned;

  // Canonicalize the subject id (NFC, the chain's stored form) so the lookup
  // keys on the same string the projection does.
  const id = canonicalId(input.id);
  const skills = projectedSkills(ctx);
  const current = id === undefined ? undefined : skills.get(id);
  if (id === undefined || current === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_SKILL',
      message: `skill "${oneLine(input.id)}" does not exist`,
    };
  }

  // `who` is this installation's authorizing anchor, never supplied.
  const who = authorizingAnchor(ctx);

  // Resolved before the gate, and the RESOLVED value is both what the gate judges
  // and what the envelope records — `which` is free text and goes through the same
  // door as the proof, so screening it and then recording something else would be
  // the very mismatch the resolution exists to prevent.
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  const verdict = skillGate({
    from: current.state,
    action,
    ...(proof !== undefined ? { fields: proof.fields } : {}),
    who,
    ...(which !== undefined ? { which } : {}),
  });
  if (!verdict.ok) return verdict;

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
      ...(pinned.fields.run !== undefined ? { run: pinned.fields.run } : {}),
    },
    {
      from: current.state,
      to: verdict.to,
      action: verdict.action,
      ...(verdict.fields !== undefined ? { fields: verdict.fields } : {}),
    },
  );
  const appended = appendEvent(ctx.writer, event);
  if (!appended.ok) return appended;
  return {
    ok: true,
    to: verdict.to,
    entry: appended.entry,
    ...screened([...(proof?.replaced ?? []), ...pinned.replaced, ...agent.replaced]),
  };
}

/**
 * Projects the skills from the chain (the source of truth), not the cache, so
 * the state/existence checks are gated against what the chain actually proves.
 */
function projectedSkills(ctx: SkillWriteContext): Map<string, SkillProjection> {
  const events: readonly CatalogEvent[] = orderedEvents(ctx.layout, ctx.upcasters);
  return projectSkills(events);
}
