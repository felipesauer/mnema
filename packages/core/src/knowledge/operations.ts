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
 *     append-only log, where it could not be repaired afterwards. That resolution
 *     SCREENS the agent name as well — one of the two fields a caller supplies on
 *     the ENVELOPE, the other being the pinned `run`, which is screened with the
 *     payload above — so what they replaced joins the payload's in one report, and
 *     a caller reads a single list rather than remembering to merge three.
 *   - the memory's id is MINTED by the operation (see {@link mintId}), never
 *     chosen by the caller, so two offline clones never mint the same id and two
 *     unrelated memories cannot false-merge when their chains are unioned.
 *   - the installation founds its anchor before its first fact, so the captured
 *     memory's signer is a key valid for its anchor at verify.
 *   - the finished event passes the READER's own rule before it is appended
 *     ({@link appendEvent}). A fact is where this mattered most: `link "" tgt` and
 *     `handoff "" a b` put an empty value in the event's SUBJECT, and once such an
 *     entry was on the tail no read of that project ever opened again.
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
  type CatalogEvent,
  handoffRecorded,
  knowledgeLinked,
  linkRetracted,
  mayRetract,
  memoryCaptured,
  noteRetracted,
  observationRecorded,
} from '@mnema/chain';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { canonicalId, mintId } from '../identity/id.js';
import { oneLine } from '../one-line.js';
import { linkOf, projectLinkAssertions, withdraws } from '../projections/knowledge.js';
import { orderedEvents } from '../projections/order.js';
import { type AppendRefusal, appendEvent } from '../workflow/append.js';
import { type Judged, onTheRecordAsItStands } from '../workflow/as-the-record-stands.js';
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
 * The refusals a point-in-time fact can earn, all of them before any append: it
 * authorized itself, one of its fields was over the size limit, or a field the
 * catalog needs came in empty and no read would have accepted the fact.
 */
export type FactError = SelfAuthorizedErr | ScreenRefusal | AppendRefusal;

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
  // The content and the pinned run: the run is on the envelope rather than the
  // payload, but it is a caller's string this package proves nothing about, so it
  // is screened here and not forwarded raw.
  const content = screenContent({ content: input.content, run: input.run });
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
  // valid for its anchor at verify.
  // Once founded it appends nothing, and refuses an anchor that no longer counts
  // this key (see `ensureFounded`).
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const appended = appendEvent(
    ctx.writer,
    memoryCaptured(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        ...(which !== undefined ? { which } : {}),
        ...(content.fields.run !== undefined ? { run: content.fields.run } : {}),
      },
      // The screened text, never `input.content` — the whole point of the door is
      // that the original does not reach the chain.
      { content: content.fields.content },
    ),
  );
  if (!appended.ok) return appended;
  return { ok: true, id, ...screened([...content.replaced, ...agent.replaced]) };
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
  //
  // The pinned run is in here for the same reason `about` is: it is a caller's
  // string nothing in this package proves, and it rides the envelope of every event
  // of the session rather than this one alone.
  const text = screenContent({
    about: input.about,
    topic: input.topic,
    text: input.text,
    run: input.run,
  });
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
  const appended = appendEvent(
    ctx.writer,
    observationRecorded(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        ...(which !== undefined ? { which } : {}),
        ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
      },
      { about, topic: text.fields.topic, text: text.fields.text },
    ),
  );
  if (!appended.ok) return appended;
  return { ok: true, id, ...screened([...text.replaced, ...agent.replaced]) };
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
  // The run joins them on the same grounds as `task`: a caller's string nothing
  // here proves, riding the envelope of every event of the session.
  const agents = screenContent({
    // Handed in as `subject`, which is what it BECOMES and the key the classification
    // answers under — a subject is a name on every kind whose subject reaches the door.
    subject: input.task,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    run: input.run,
  });
  if (!agents.ok) return agents;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;
  const task = canonicalId(agents.fields.subject) ?? agents.fields.subject;

  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const appended = appendEvent(
    ctx.writer,
    handoffRecorded(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: task,
        ...(which !== undefined ? { which } : {}),
        ...(agents.fields.run !== undefined ? { run: agents.fields.run } : {}),
      },
      { fromAgent: agents.fields.fromAgent, toAgent: agents.fields.toAgent },
    ),
  );
  if (!appended.ok) return appended;
  return {
    ok: true,
    fromAgent: agents.fields.fromAgent,
    toAgent: agents.fields.toAgent,
    ...screened([...agents.replaced, ...agent.replaced]),
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
  /**
   * What the link points at. An id of another record for most relations, and a PATH
   * for `governs` — which is why this is not typed, checked or resolved here: it is
   * the caller's string, and the reader decides what it names.
   */
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
 * UNLIKE {@link supersedeDecision}, THIS DOES NOT REFUSE A DANGLING TARGET.
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
    // And the pinned run, the envelope's own unproved string.
    run: input.run,
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
  const appended = appendEvent(
    ctx.writer,
    knowledgeLinked(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject,
        ...(which !== undefined ? { which } : {}),
        ...(relation.fields.run !== undefined ? { run: relation.fields.run } : {}),
      },
      { target, rel: relation.fields.rel },
    ),
  );
  if (!appended.ok) return appended;
  return {
    ok: true,
    rel: relation.fields.rel,
    ...screened([...relation.replaced, ...agent.replaced]),
  };
}

/** A note was retracted: the fact was appended. */
export interface RetractOk extends ScreenedWrite {
  readonly ok: true;
  /** The retracted note's id (the event subject), in the record's canonical form. */
  readonly id: string;
  /** What the note was: the kind a surface names it by. */
  readonly note: 'memory' | 'observation';
}

/** A retraction refused before touching the chain. */
export type RetractError =
  | FactError
  /** This tree holds no record by that id. */
  | { readonly ok: false; readonly code: 'UNKNOWN_NOTE'; readonly message: string }
  /** The id names a record with a lifecycle of its own — a decision, a pattern, a task. */
  | { readonly ok: false; readonly code: 'NOT_A_NOTE'; readonly message: string }
  /** The record already took this note back. */
  | { readonly ok: false; readonly code: 'ALREADY_RETRACTED'; readonly message: string }
  /** The note was written by another identity, and only that identity retracts it. */
  | { readonly ok: false; readonly code: 'NOT_THE_AUTHOR'; readonly message: string };

/** What the caller asks to retract. */
export interface RetractInput {
  /** The id of the memory or observation to take back. */
  readonly id: string;
  /** Why it is taken back. Required; a reason that says nothing is refused. */
  readonly reason: string;
  /** The agent that carried it out, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** What one id names in a tree, as far as a retraction needs to know. */
type Standing =
  | {
      readonly is: 'note';
      readonly note: 'memory' | 'observation';
      /** The identity that wrote it. */
      readonly who: string;
      /** When a retraction by that identity took it back, if one did. */
      readonly retractedAt?: string;
    }
  | { readonly is: 'other'; readonly what: 'decision' | 'pattern' | 'task' }
  | { readonly is: 'nothing' };

/** The birth kinds of the records that are NOT notes, and how a person names each. */
const NOT_A_NOTE: { readonly [kind: string]: 'decision' | 'pattern' | 'task' } = {
  'decision.recorded': 'decision',
  'skill.created': 'pattern',
  'task.created': 'task',
};

/** What each record that is not a note does instead of being retracted. */
const ITS_OWN_LIFECYCLE = {
  decision: 'reject it, or supersede it with another',
  pattern: 'reject it, or deprecate it',
  task: 'move it to the state it is in',
} as const;

/**
 * Reads what `id` names in this tree's ordered stream. A retraction counts only when its
 * identity may retract the note ({@link mayRetract}) — the rule the read applies — so a
 * stranger's retraction neither hides the note nor stands in its author's way.
 */
function standingOf(events: readonly CatalogEvent[], id: string): Standing {
  let note: { readonly note: 'memory' | 'observation'; readonly who: string } | undefined;
  const retractions: { readonly at: string; readonly who: string }[] = [];
  for (const event of events) {
    if (event.subject !== id) continue;
    if (event.kind === 'memory.captured') note = { note: 'memory', who: event.who };
    else if (event.kind === 'observation.recorded') note = { note: 'observation', who: event.who };
    else if (event.kind === 'note.retracted') retractions.push({ at: event.at, who: event.who });
    else {
      const what = NOT_A_NOTE[event.kind];
      if (what !== undefined) return { is: 'other', what };
    }
  }
  if (note === undefined) return { is: 'nothing' };
  const author = note.who;
  const retractedAt = retractions.find((retraction) => mayRetract(author, retraction.who))?.at;
  return { is: 'note', ...note, ...(retractedAt !== undefined ? { retractedAt } : {}) };
}

/**
 * Retracts a note — a memory or an observation — by appending one `note.retracted` whose
 * subject is the note and whose payload is the reason. Nothing is erased: the note's own
 * event stays, a verifier still sees it, and the read by id still serves it, saying it was
 * taken back; the reads that LIST notes stop offering it.
 *
 * WHO MAY is the identity that wrote the note, with any key of it ({@link mayRetract}): a
 * writer of another identity is refused, told whose the note is. The fact is attributed to the
 * anchor (`who`) and to the agent that carried it out (`which`). It is SAME-TREE:
 * the note is looked for in the tree this writer owns — a surface opens the note's own tree,
 * the way a decision's move follows the decision — and a retraction of an id this tree does
 * not hold is refused rather than recorded dangling.
 *
 * Decided under the tail's lock against the record as it stands ({@link
 * onTheRecordAsItStands}), so two retractions of one note in two sessions append one.
 */
export function retractNote(ctx: WriteContext, input: RetractInput): RetractOk | RetractError {
  // The reason and the pinned run through the door first, as every fact's free text is.
  const text = screenContent({ reason: input.reason, run: input.run });
  if (!text.ok) return text;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  const id = canonicalId(input.id);
  return onTheRecordAsItStands(
    ctx,
    () =>
      id === undefined
        ? ({ is: 'nothing' } as const)
        : standingOf(orderedEvents(ctx.layout, ctx.upcasters), id),
    (standing): Judged<RetractOk | RetractError> => {
      if (id === undefined || standing.is === 'nothing') {
        return {
          refuse: {
            ok: false,
            code: 'UNKNOWN_NOTE',
            message: `no memory or observation "${oneLine(input.id)}" is in this record`,
          },
        };
      }
      if (standing.is === 'other') {
        return {
          refuse: {
            ok: false,
            code: 'NOT_A_NOTE',
            message:
              `${standing.what} "${oneLine(input.id)}" is not a note: only a memory or an ` +
              `observation is retracted. A ${standing.what} keeps its own lifecycle — ` +
              `${ITS_OWN_LIFECYCLE[standing.what]}.`,
          },
        };
      }
      if (!mayRetract(standing.who, who)) {
        return {
          refuse: {
            ok: false,
            code: 'NOT_THE_AUTHOR',
            message:
              `${standing.note} "${oneLine(input.id)}" was written by ${oneLine(standing.who)}, ` +
              `and only that identity retracts it; this writer is ${oneLine(who)}. ` +
              'Nothing was appended.',
          },
        };
      }
      if (standing.retractedAt !== undefined) {
        return {
          refuse: {
            ok: false,
            code: 'ALREADY_RETRACTED',
            message:
              `${standing.note} "${oneLine(input.id)}" was already retracted at ` +
              `${oneLine(standing.retractedAt)}. Nothing was appended.`,
          },
        };
      }
      return {
        write: () => {
          ensureFounded(ctx);
          const at = (ctx.clock ?? systemClock)();
          const appended = appendEvent(
            ctx.writer,
            noteRetracted(
              {
                at,
                who,
                signerFp: ctx.writer.signerFingerprint,
                subject: id,
                ...(which !== undefined ? { which } : {}),
                ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
              },
              // The screened reason, never `input.reason`.
              { reason: text.fields.reason },
            ),
          );
          if (!appended.ok) return appended;
          return {
            ok: true,
            id,
            note: standing.note,
            ...screened([...text.replaced, ...agent.replaced]),
          };
        },
      };
    },
  );
}

/** A link was retracted: the fact was appended. */
export interface LinkRetractOk extends ScreenedWrite {
  readonly ok: true;
  /** The edge taken back, as the link recorded it. */
  readonly subject: string;
  readonly target: string;
  readonly rel: string;
}

/** A link retraction refused before touching the chain. */
export type LinkRetractError =
  | FactError
  /** This tree holds no link of that subject, target and relation. */
  | { readonly ok: false; readonly code: 'UNKNOWN_LINK'; readonly message: string }
  /** This identity recorded the link, and the record already took it back. */
  | { readonly ok: false; readonly code: 'ALREADY_RETRACTED'; readonly message: string }
  /** The link was recorded by another identity, and only that identity retracts it. */
  | { readonly ok: false; readonly code: 'NOT_THE_AUTHOR'; readonly message: string };

/** What the caller asks to retract: the edge, named the way the link named it. */
export interface LinkRetractInput {
  /** The entity the link originates from. */
  readonly subject: string;
  /** What the link points at. */
  readonly target: string;
  /** The relation label, exactly as the link recorded it. */
  readonly rel: string;
  /** Why it is taken back. Required; a reason that says nothing is refused. */
  readonly reason: string;
  /** The agent that carried it out, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** What the record says of one edge, as far as a retraction by `who` needs to know. */
type LinkStanding =
  | { readonly is: 'nothing' }
  | { readonly is: 'mine' }
  | { readonly is: 'withdrawn' }
  | { readonly is: 'theirs'; readonly authors: readonly string[] };

/**
 * Reads what this tree's ordered stream says of the edge, for a retraction by `who`: whether
 * an assertion of it that `who` may retract still stands ({@link mayRetract}, through the
 * read's own {@link withdraws}), whether one did and was taken back, or whether only other
 * identities ever asserted it.
 */
function linkStandingOf(
  events: readonly CatalogEvent[],
  edge: { readonly subject: string; readonly target: string; readonly rel: string },
  who: string,
): LinkStanding {
  const same = (link: { subject: string; target: string; rel: string }) =>
    link.subject === edge.subject && link.target === edge.target && link.rel === edge.rel;
  const asserted = events.flatMap((event) => {
    const link = linkOf(event);
    return link !== undefined && same(link) ? [link] : [];
  });
  if (asserted.length === 0) return { is: 'nothing' };
  const asWho = { ...edge, who };
  const standing = projectLinkAssertions(events).filter(same);
  if (standing.some((assertion) => withdraws(asWho, assertion))) return { is: 'mine' };
  if (asserted.some((assertion) => withdraws(asWho, assertion))) return { is: 'withdrawn' };
  return { is: 'theirs', authors: [...new Set(asserted.map((assertion) => assertion.who))] };
}

/**
 * Retracts a link by appending one `link.retracted` that names the edge as the link did —
 * subject, target, relation — and why. Nothing is erased: the link's own event stays and a
 * verifier still sees it; every reader of links, which reads the edges the record still
 * asserts, stops seeing this identity's assertion of it, and the edge with it when nobody
 * else asserts it.
 *
 * WHO MAY is the identity that recorded the link, with any key of it ({@link mayRetract}): a
 * writer of another identity is refused, told whose the link is. It is SAME-TREE: the edge
 * is looked for in the tree this writer owns — a surface opens the tree the link landed in —
 * and an edge this tree does not hold is refused rather than recorded dangling.
 *
 * Decided under the tail's lock against the record as it stands ({@link
 * onTheRecordAsItStands}), so two retractions of one link in two sessions append one.
 */
export function retractLink(
  ctx: WriteContext,
  input: LinkRetractInput,
): LinkRetractOk | LinkRetractError {
  // The edge's two names go through the door as the link's did — a name carrying a credential
  // is refused, never replaced, so a clean one comes back as it went in — and the reason too.
  const text = screenContent({
    target: input.target,
    rel: input.rel,
    reason: input.reason,
    run: input.run,
  });
  if (!text.ok) return text;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  const edge = {
    subject: canonicalId(input.subject) ?? input.subject,
    target: canonicalId(text.fields.target) ?? text.fields.target,
    rel: text.fields.rel,
  };
  const named = `${oneLine(edge.subject)} —${oneLine(edge.rel)}→ ${oneLine(edge.target)}`;
  return onTheRecordAsItStands(
    ctx,
    () => linkStandingOf(orderedEvents(ctx.layout, ctx.upcasters), edge, who),
    (standing): Judged<LinkRetractOk | LinkRetractError> => {
      if (standing.is === 'nothing') {
        return {
          refuse: {
            ok: false,
            code: 'UNKNOWN_LINK',
            message: `no link ${named} is in this record`,
          },
        };
      }
      if (standing.is === 'theirs') {
        return {
          refuse: {
            ok: false,
            code: 'NOT_THE_AUTHOR',
            message:
              `the link ${named} was recorded by ${standing.authors.map(oneLine).join(', ')}, ` +
              `and only that identity retracts it; this writer is ${oneLine(who)}. ` +
              'Nothing was appended.',
          },
        };
      }
      if (standing.is === 'withdrawn') {
        return {
          refuse: {
            ok: false,
            code: 'ALREADY_RETRACTED',
            message: `the link ${named} was already retracted. Nothing was appended.`,
          },
        };
      }
      return {
        write: () => {
          ensureFounded(ctx);
          const at = (ctx.clock ?? systemClock)();
          const appended = appendEvent(
            ctx.writer,
            linkRetracted(
              {
                at,
                who,
                signerFp: ctx.writer.signerFingerprint,
                subject: edge.subject,
                ...(which !== undefined ? { which } : {}),
                ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
              },
              // The screened reason, never `input.reason`.
              { target: edge.target, rel: edge.rel, reason: text.fields.reason },
            ),
          );
          if (!appended.ok) return appended;
          return {
            ok: true,
            ...edge,
            ...screened([...text.replaced, ...agent.replaced]),
          };
        },
      };
    },
  );
}
