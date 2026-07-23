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
 *   - `who` (the authorizing anchor) and `signerFp` (the signing key) come from
 *     the writer's own key, never supplied — a caller cannot forge who captured
 *     a memory by typing a name.
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
 * The other knowledge writes share this shape exactly — one append, no gate, no
 * error union — because they are all point-in-time FACTS:
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
import { canonicalId, mintId } from '../identity/id.js';
import { canonicalIdentity } from '../identity/who.js';
import { systemClock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';

/** A memory was captured: the fact was appended. */
export interface CaptureOk {
  readonly ok: true;
  /** The new memory's id (the event subject). */
  readonly id: string;
}

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
 */
export function captureMemory(ctx: WriteContext, input: CaptureInput): CaptureOk {
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);

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
      { content: input.content },
    ),
  );
  return { ok: true, id };
}

/** An observation was recorded: the fact was appended. */
export interface ObservationOk {
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
export function recordObservation(ctx: WriteContext, input: ObservationInput): ObservationOk {
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);
  // The observed entity is a REFERENCE to an already-minted id: canonicalized
  // (NFC, the chain's stored form) so a reader keys on the same string, but
  // never minted here and never refused for absence.
  const about = canonicalId(input.about) ?? input.about;

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
      { about, topic: input.topic, text: input.text },
    ),
  );
  return { ok: true, id };
}

/** A handoff was recorded: the fact was appended. */
export interface HandoffOk {
  readonly ok: true;
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
export function recordHandoff(ctx: WriteContext, input: HandoffInput): HandoffOk {
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);
  const task = canonicalId(input.task) ?? input.task;

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
      { fromAgent: input.fromAgent, toAgent: input.toAgent },
    ),
  );
  return { ok: true };
}

/** A knowledge link was recorded: the fact was appended. */
export interface LinkOk {
  readonly ok: true;
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
export function linkKnowledge(ctx: WriteContext, input: LinkInput): LinkOk {
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);
  const subject = canonicalId(input.subject) ?? input.subject;
  const target = canonicalId(input.target) ?? input.target;

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
      { target, rel: input.rel },
    ),
  );
  return { ok: true };
}
