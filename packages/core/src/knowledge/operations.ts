/**
 * Capturing knowledge: the write operations for the knowledge domain.
 *
 * Knowledge is a point-in-time FACT, not a gated move. A memory has no state to
 * judge, no prior state to check, and no lifecycle — so unlike a task
 * transition, capturing one runs no gate. It is one append: mint the memory's
 * own id, stamp the envelope, emit `memory.captured`. That the fact is
 * immutable is what makes the gate irrelevant here — there is nothing to
 * authorize about a fact that will never move.
 *
 * The disciplines the work operations rely on still hold, because they defend
 * the proof, not the workflow:
 *   - every piece of free text is screened before anything else happens ({@link
 *     screenContent}): a field over the size limit refuses the whole write, and a
 *     recognized credential is replaced by a typed placeholder. A fact is the
 *     shape most exposed to this — it is unstructured text with no field that
 *     disciplines what goes in — and it is permanent, so the door is the only
 *     place the question can still be answered.
 *   - `who` (the authorizing anchor) and `signerFp` (the signing key) come from
 *     the writer's own key, never supplied — a caller cannot forge who captured
 *     a memory by typing a name.
 *   - the executing agent is never that same identity ({@link
 *     resolveExecutingAgent}). No gate runs here, but this is not a gate rule:
 *     it is the authority invariant, and the verifier applies it to EVERY kind.
 *     Checking it at the door is what keeps a self-authorized fact out of an
 *     append-only log, where it could not be repaired afterwards.
 *   - the memory's id is MINTED by the operation (see {@link mintId}), never
 *     chosen by the caller, so two offline clones never mint the same id and two
 *     unrelated memories cannot false-merge when their chains are unioned.
 *   - the installation founds its anchor before its first fact, so the captured
 *     memory's signer is a key valid for its anchor at verify.
 *
 * WHICH tree a capture lands in is not decided here: a caller opens the tree
 * for the resolved scope (`openTreeForWriting`) and hands the resulting writer
 * in via the context. This operation writes to whatever chain that writer owns.
 *
 * The other knowledge writes share this shape exactly — one append, no gate, and
 * the one refusal a fact can earn (the authority invariant) — because they are
 * all point-in-time FACTS:
 *   - {@link recordObservation}: a note ABOUT an entity. It mints its OWN id
 *     (the observation is an entity), and names the observed one in the payload.
 *   - {@link recordHandoff}: work on a task passed between agents. Its subject
 *     IS the task, not a fresh id; multiple handoffs on one task are a list.
 *   - {@link linkKnowledge}: the first RELATIONAL fact — one entity relates to
 *     another. Unlike a supersede it does NOT refuse a dangling target: the
 *     relation is legitimately cross-tree and the writer has no global view, so
 *     the link is an asserted fact resolved on read against the union.
 */

import {
  handoffRecorded,
  knowledgeLinked,
  memoryCaptured,
  observationRecorded,
} from '@mnema/chain';
import {
  type ContentTooLargeErr,
  type ScreenedWrite,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { canonicalId, mintId } from '../identity/id.js';
import { systemClock } from '../workflow/clock.js';
import { authorizingAnchor, ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';

/** A memory was captured: the fact was appended. */
export interface CaptureOk extends ScreenedWrite {
  readonly ok: true;
  /** The new memory's id (the event subject). */
  readonly id: string;
}

/**
 * The refusals a point-in-time fact can earn, both of them before any append: it
 * authorized itself, or one of its fields was over the size limit.
 */
export type FactError = SelfAuthorizedErr | ContentTooLargeErr;

/** What the caller asks to capture. */
export interface CaptureInput {
  /** The content of the memory. */
  readonly content: string;
  /** The agent that captured it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Captures a memory: mints its id, then appends the single `memory.captured`
 * fact stamped with one `at`. The id is minted here, never supplied — the caller
 * receives it back in {@link CaptureOk.id}. There is no birth pair and no gate:
 * a memory has no state, so nothing is judged and nothing is transitioned. `who`
 * is the writer's anchor, derived from its key; `which` is the executing agent,
 * whose presence is exactly what the scope resolver reads to default an
 * automatic capture to the private tree.
 *
 * The content is screened FIRST, before the identity is even consulted: it is the
 * one check that needs no context at all, and running it ahead of everything else
 * is what makes an oversize refusal cost nothing and touch nothing.
 */
export function captureMemory(ctx: WriteContext, input: CaptureInput): CaptureOk | FactError {
  const content = screenContent({ content: input.content });
  if (!content.ok) return content;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  // Minted here, not chosen by the caller: derived from randomness so two
  // offline clones never mint the same one, closing false-merge of memories at
  // the root (the same move `who` makes). Canonical by construction.
  const id = mintId();

  // Found this installation's anchor before the fact, so its signer is a key
  // valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    memoryCaptured(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        ...(which !== undefined ? { which } : {}),
        ...(input.run !== undefined ? { run: input.run } : {}),
      },
      // The screened text, never `input.content` — the whole point of the door is
      // that the original does not reach the chain.
      { content: content.fields.content },
    ),
  );
  return { ok: true, id, ...screened(content.replaced) };
}

/** An observation was recorded: the fact was appended. */
export interface ObservationOk extends ScreenedWrite {
  readonly ok: true;
  /** The new observation's OWN minted id (the event subject). */
  readonly id: string;
}

/** What the caller asks to observe. */
export interface ObservationInput {
  /** The id of the entity being observed (a task, decision, …). */
  readonly about: string;
  /** A short topic label. */
  readonly topic: string;
  /** The observation text. */
  readonly text: string;
  /** The agent that recorded it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Records an observation about an entity: mints the observation's OWN id, then
 * appends one `observation.recorded` fact. The id is minted here, never
 * supplied — an observation is itself an entity ("I noted X about Y"), so it
 * carries its own subject and names the observed entity in `about`. Two
 * observations about the same entity therefore never collide on one subject.
 *
 * The `about` target is NOT verified to exist: the observed entity may live in
 * another tree the writer cannot see, so a dangling `about` is an honest
 * cross-tree assertion resolved on read, never a refusal here.
 */
export function recordObservation(
  ctx: WriteContext,
  input: ObservationInput,
): ObservationOk | FactError {
  // Every field in one screen, so a single refusal covers any of them and the
  // report counts what was replaced across all three.
  //
  // `about` is in here WITH the text, and that is not decoration. It is an id by
  // contract but it is NOT validated (a dangling cross-tree reference is honest),
  // so in practice it holds whatever a caller sends — which means it is the one
  // field of this operation that could carry an unbounded value into the chain, and
  // a fat event is exactly what the size limit exists to keep out. No real id can
  // match a credential shape, so screening it cannot corrupt a legitimate
  // reference.
  const text = screenContent({ about: input.about, topic: input.topic, text: input.text });
  if (!text.ok) return text;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;
  // The observed entity is a REFERENCE to an already-minted id: canonicalized
  // (NFC, the chain's stored form) so a reader keys on the same string, but
  // never minted here and never refused for absence. It runs AFTER the screen so
  // the canonicalization — which serializes the value to check the chain can hold
  // it — is bounded by the size limit rather than paying for whatever arrived.
  const about = canonicalId(text.fields.about) ?? text.fields.about;

  // Minted here, not chosen by the caller (see mintId): the observation's own
  // identity, canonical by construction.
  const id = mintId();

  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    observationRecorded(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        ...(which !== undefined ? { which } : {}),
        ...(input.run !== undefined ? { run: input.run } : {}),
      },
      { about, topic: text.fields.topic, text: text.fields.text },
    ),
  );
  return { ok: true, id, ...screened(text.replaced) };
}

/** A handoff was recorded: the fact was appended. */
export interface HandoffOk extends ScreenedWrite {
  readonly ok: true;
  /**
   * The two labels AS RECORDED — screened, so a surface that echoes them shows
   * what landed rather than what was asked for. A handoff mints no id, so this is
   * the only thing a caller has to report the fact by.
   */
  readonly fromAgent: string;
  readonly toAgent: string;
}

/** What the caller asks to record as a handoff. */
export interface HandoffInput {
  /** The task the handoff is about (the event subject). */
  readonly task: string;
  /** The agent handing off. */
  readonly fromAgent: string;
  /** The agent taking over (may equal `fromAgent`: a chat restart). */
  readonly toAgent: string;
  /** The agent that recorded it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Records a handoff on a task: appends one `handoff.recorded` fact whose subject
 * IS the task. Unlike an observation, no id is minted — a handoff has no
 * standalone identity; it is an entry in the task's history. Multiple handoffs
 * on one task share the subject and do not collide, because each is a distinct
 * event and the projection accumulates them into a list. `fromAgent == toAgent`
 * is legitimate (a chat restart with the same agent) and not refused.
 *
 * The task subject is NOT verified to exist here — it is a reference resolved on
 * read, the same cross-tree-honest treatment the observation and link use.
 */
export function recordHandoff(ctx: WriteContext, input: HandoffInput): HandoffOk | FactError {
  // The two agent labels are free text, so they are screened like any other: a
  // label is where someone pastes a connection string to say which service the
  // work moved to. `task` joins them because it becomes the event's SUBJECT and is
  // never validated, so it is the field through which an unbounded value could
  // reach the chain.
  const agents = screenContent({
    task: input.task,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
  });
  if (!agents.ok) return agents;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;
  const task = canonicalId(agents.fields.task) ?? agents.fields.task;

  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    handoffRecorded(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: task,
        ...(which !== undefined ? { which } : {}),
        ...(input.run !== undefined ? { run: input.run } : {}),
      },
      { fromAgent: agents.fields.fromAgent, toAgent: agents.fields.toAgent },
    ),
  );
  return {
    ok: true,
    fromAgent: agents.fields.fromAgent,
    toAgent: agents.fields.toAgent,
    ...screened(agents.replaced),
  };
}

/** A knowledge link was recorded: the fact was appended. */
export interface LinkOk extends ScreenedWrite {
  readonly ok: true;
  /** The relation AS RECORDED — screened, so an echo shows what landed. */
  readonly rel: string;
}

/** What the caller asks to link. */
export interface LinkInput {
  /** The entity that ORIGINATES the link (the event subject). */
  readonly subject: string;
  /** The id of the entity linked to. */
  readonly target: string;
  /** The relation label — an open literal string (see the catalog's recommended set). */
  readonly rel: string;
  /** The agent that recorded it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Links one piece of knowledge to another: appends one `knowledge.linked` fact
 * whose subject is the ORIGINATING entity and whose payload names the `target`
 * and the relation `rel`. Both `subject` and `target` are references to
 * already-minted ids (canonicalized, never minted here).
 *
 * ⚠️ Unlike {@link supersedeDecision}, this does NOT refuse a dangling target.
 * A link is legitimately cross-tree — a private memory may point at a public
 * task — and the writer sees only its own tree, so it cannot confirm the target
 * exists globally. The link is an asserted fact; a target absent from the
 * current view is honest dangling, resolved on read against the union. Refusing
 * it here would break the very cross-tree relations the link exists to record.
 */
export function linkKnowledge(ctx: WriteContext, input: LinkInput): LinkOk | FactError {
  // `rel` is an OPEN string, so it is free text by definition. Both endpoints join
  // it: neither is validated (that is the whole point of a cross-tree link), so
  // each is a field through which an unbounded value could reach the chain — one as
  // the event's subject, one in its payload.
  const relation = screenContent({
    subject: input.subject,
    target: input.target,
    rel: input.rel,
  });
  if (!relation.ok) return relation;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;
  const subject = canonicalId(relation.fields.subject) ?? relation.fields.subject;
  const target = canonicalId(relation.fields.target) ?? relation.fields.target;

  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    knowledgeLinked(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject,
        ...(which !== undefined ? { which } : {}),
        ...(input.run !== undefined ? { run: input.run } : {}),
      },
      { target, rel: relation.fields.rel },
    ),
  );
  return { ok: true, rel: relation.fields.rel, ...screened(relation.replaced) };
}
