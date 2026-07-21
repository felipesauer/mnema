/**
 * Builders for cataloged events.
 *
 * Constructing events through these keeps two invariants a hand-written object
 * literal can quietly break: the latest version is always stamped, and absent
 * optional fields are OMITTED rather than set to `undefined`. The second
 * matters because canonicalization refuses an explicit `undefined` (an
 * ambiguous "is the key there or not?") — so a builder that leaves the key out
 * entirely is the safe path to a signable event.
 */

import type { CatalogEvent, TransitionFields } from './catalog.js';
import type { Envelope } from './envelope.js';

/** The envelope fields a caller supplies; `v` and `kind` come from the builder. */
type EnvelopeInput = Omit<Envelope, 'v' | 'kind'>;

/** Copies only the defined envelope fields, never writing an explicit undefined. */
function envelopeFields(input: EnvelopeInput): EnvelopeInput {
  const base: { at: string; who: string; subject: string; which?: string; run?: string } = {
    at: input.at,
    who: input.who,
    subject: input.subject,
  };
  if (input.which !== undefined) base.which = input.which;
  if (input.run !== undefined) base.run = input.run;
  return base;
}

/** Builds a `run.started` event (subject = the run's id). */
export function runStarted(
  envelope: EnvelopeInput,
  payload: { agent: string; goal?: string },
): CatalogEvent {
  const p: { agent: string; goal?: string } = { agent: payload.agent };
  if (payload.goal !== undefined) p.goal = payload.goal;
  return { v: 1, kind: 'run.started', ...envelopeFields(envelope), payload: p };
}

/** Builds a `run.ended` event (subject = the run's id). */
export function runEnded(
  envelope: EnvelopeInput,
  payload: { outcome?: string } = {},
): CatalogEvent {
  const p: { outcome?: string } = {};
  if (payload.outcome !== undefined) p.outcome = payload.outcome;
  return { v: 1, kind: 'run.ended', ...envelopeFields(envelope), payload: p };
}

/** Builds a `task.created` event (subject = the task's id). */
export function taskCreated(envelope: EnvelopeInput, payload: { title: string }): CatalogEvent {
  return {
    v: 1,
    kind: 'task.created',
    ...envelopeFields(envelope),
    payload: { title: payload.title },
  };
}

/**
 * Copies only the meaningful proof fields. A field that is undefined OR empty
 * (an empty string, or an empty links array) is treated as absence and omitted
 * — the same rule the parser enforces on read (it rejects an empty string or an
 * empty array). Keeping the builder symmetric with the parser is what makes an
 * event valid-by-construction: a caller cannot produce a line the chain can
 * write but never read back.
 */
function transitionFields(fields: TransitionFields): TransitionFields {
  const out: {
    reason?: string;
    note?: string;
    feedback?: string;
    pr_url?: string;
    links?: readonly string[];
  } = {};
  if (nonEmptyString(fields.reason)) out.reason = fields.reason;
  if (nonEmptyString(fields.note)) out.note = fields.note;
  if (nonEmptyString(fields.feedback)) out.feedback = fields.feedback;
  if (nonEmptyString(fields.pr_url)) out.pr_url = fields.pr_url;
  if (fields.links !== undefined && fields.links.length > 0) out.links = fields.links;
  return out;
}

function nonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/**
 * Builds a `task.transitioned` event (subject = the task's id). `from` is a
 * literal state string, or `null` for the birth transition that gives a task
 * its initial state. `fields` carries the transition's proof (the why, links);
 * it is omitted entirely when empty, so a transition with no proof stays
 * byte-identical to one built without the argument.
 */
export function taskTransitioned(
  envelope: EnvelopeInput,
  payload: { from: string | null; to: string; action: string; fields?: TransitionFields },
): CatalogEvent {
  const p: {
    from: string | null;
    to: string;
    action: string;
    fields?: TransitionFields;
  } = { from: payload.from, to: payload.to, action: payload.action };
  if (payload.fields !== undefined) {
    const trimmed = transitionFields(payload.fields);
    if (Object.keys(trimmed).length > 0) p.fields = trimmed;
  }
  return {
    v: 1,
    kind: 'task.transitioned',
    ...envelopeFields(envelope),
    payload: p,
  };
}

/** The literal `action` a birth transition always carries. */
export const BIRTH_ACTION = 'create';

/**
 * Builds a `decision.recorded` event (subject = the decision's id). Unlike a
 * task's creation, the decision's fact carries its `rationale` (the why) and
 * its frozen `adr` label — both part of the immutable record.
 */
export function decisionRecorded(
  envelope: EnvelopeInput,
  payload: { title: string; rationale: string; adr: string },
): CatalogEvent {
  return {
    v: 1,
    kind: 'decision.recorded',
    ...envelopeFields(envelope),
    payload: { title: payload.title, rationale: payload.rationale, adr: payload.adr },
  };
}

/**
 * Builds a `decision.transitioned` event (subject = the decision's id). `from`
 * is a literal state string, or `null` for the birth transition. `by` — the
 * successor decision's id — is written only on a supersede and omitted
 * otherwise; `fields` carries the transition's proof and is omitted entirely
 * when empty, so a transition with no proof stays byte-identical to one built
 * without the argument.
 */
export function decisionTransitioned(
  envelope: EnvelopeInput,
  payload: {
    from: string | null;
    to: string;
    action: string;
    by?: string;
    fields?: TransitionFields;
  },
): CatalogEvent {
  const p: {
    from: string | null;
    to: string;
    action: string;
    by?: string;
    fields?: TransitionFields;
  } = { from: payload.from, to: payload.to, action: payload.action };
  if (nonEmptyString(payload.by)) p.by = payload.by;
  if (payload.fields !== undefined) {
    const trimmed = transitionFields(payload.fields);
    if (Object.keys(trimmed).length > 0) p.fields = trimmed;
  }
  return {
    v: 1,
    kind: 'decision.transitioned',
    ...envelopeFields(envelope),
    payload: p,
  };
}

/**
 * Builds the pair of events a decision's birth always emits, in order: the
 * `decision.recorded` that proves it exists (with its why and frozen label),
 * then the birth `decision.transitioned` (`from: null`) that establishes its
 * initial state. The two are one atomic fact — like a task, a decision never
 * exists without a state. The caller supplies `initial` because which state a
 * decision starts in is the domain's concern, not the chain's.
 */
export function decisionBirth(
  envelope: EnvelopeInput,
  payload: { title: string; rationale: string; adr: string; initial: string },
): [CatalogEvent, CatalogEvent] {
  return [
    decisionRecorded(envelope, {
      title: payload.title,
      rationale: payload.rationale,
      adr: payload.adr,
    }),
    decisionTransitioned(envelope, { from: null, to: payload.initial, action: BIRTH_ACTION }),
  ];
}

/**
 * Builds the pair of events that a task's birth always emits, in order: the
 * `task.created` that proves the task exists, then the `task.transitioned`
 * (`from: null`, `action: "create"`) that establishes its initial state.
 *
 * The two are one atomic fact — a task never exists without a state, and a
 * state is never carried by the creation event. The caller supplies `initial`
 * because the workflow (which state a task starts in) is the domain's concern,
 * not the chain's; the chain only guarantees the birth is always this shape.
 * Append both to the tail together so a reader never sees a created task with
 * no state.
 */
export function taskBirth(
  envelope: EnvelopeInput,
  payload: { title: string; initial: string },
): [CatalogEvent, CatalogEvent] {
  return [
    taskCreated(envelope, { title: payload.title }),
    taskTransitioned(envelope, { from: null, to: payload.initial, action: BIRTH_ACTION }),
  ];
}
