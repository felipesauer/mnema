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

import type { CatalogEvent } from './catalog.js';
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

/** Builds a `task.transitioned` event (subject = the task's id). */
export function taskTransitioned(
  envelope: EnvelopeInput,
  payload: { from: string; to: string; action: string },
): CatalogEvent {
  return {
    v: 1,
    kind: 'task.transitioned',
    ...envelopeFields(envelope),
    payload: { from: payload.from, to: payload.to, action: payload.action },
  };
}
