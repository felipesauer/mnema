/**
 * Parsing and validating an untrusted line into a typed catalog event.
 *
 * A line read from the chain is untrusted bytes: it may be malformed, from a
 * newer catalog, forged, or simply wrong. Parsing turns it into a
 * `CatalogEvent` or fails loudly — it never returns a half-valid event. This is
 * STRUCTURAL validation (the shape the catalog promises), not the workflow
 * gate: the gate ran once at write time and its verdict is already baked into
 * the fact. Reading replays the fact; it does not re-judge it.
 *
 * A closed catalog means a CLOSED SHAPE: an event may carry ONLY the fields its
 * kind declares. Parsing rebuilds the event from exactly those fields, so a
 * forged line cannot smuggle extra data past validation and have it ride along
 * into the signed bytes. Two consequences that serve the proof:
 *   - Unknown top-level or payload fields are rejected outright.
 *   - The returned event — and therefore its canonical bytes — is the
 *     reconstruction, never the raw parsed object. A line with a duplicate key
 *     (JSON.parse silently keeps the last) or an extra field re-canonicalizes
 *     to bytes that DIFFER from the stored line, so the chain's "stored line
 *     equals recomputed bytes" check rejects it rather than verifying it green.
 *
 * The flow is: JSON.parse → require an object with a known kind and version →
 * lift to the latest version via the upcaster ladder → validate AND rebuild the
 * latest-version shape. Validating after upcasting means the validator only
 * ever knows the current contract; old shapes are the upcasters' concern.
 */

import type { CanonicalValue } from './canonical.js';
import type { CatalogEvent, TransitionFields } from './catalog.js';
import type { UpcasterRegistry, VersionedEvent } from './upcaster.js';

/** Thrown when a line is not a valid, current-catalog event. */
export class EventParseError extends Error {
  override readonly name = 'EventParseError';
}

/** The envelope fields every kind carries, in canonical membership. */
const ENVELOPE_FIELDS = [
  'v',
  'kind',
  'at',
  'who',
  'signerFp',
  'which',
  'run',
  'subject',
  'payload',
] as const;

/** The payload fields each kind declares. Anything else is rejected. */
const PAYLOAD_FIELDS: { readonly [K in CatalogEvent['kind']]: readonly string[] } = {
  'run.started': ['agent', 'goal'],
  'run.ended': ['outcome'],
  'task.created': ['title'],
  'task.transitioned': ['from', 'to', 'action', 'fields'],
  'decision.recorded': ['title', 'rationale', 'adr'],
  'decision.transitioned': ['from', 'to', 'action', 'by', 'fields'],
  'identity.founded': ['foundingFp'],
  'key.enrolled': ['newFp', 'reverseSig'],
  'key.revoked': ['revokedFp', 'reason'],
  'memory.captured': ['content'],
  'observation.recorded': ['about', 'topic', 'text'],
  'handoff.recorded': ['fromAgent', 'toAgent'],
  'knowledge.linked': ['target', 'rel'],
  'skill.created': ['name', 'body'],
  'skill.transitioned': ['from', 'to', 'action', 'fields'],
};

/** The proof/context fields a transition's `fields` object may carry. */
const TRANSITION_FIELD_KEYS = ['reason', 'note', 'feedback', 'pr_url', 'links'] as const;

/**
 * Parses one canonical (or raw) JSON string into a current-version catalog
 * event, upcasting through the given registry. Throws {@link EventParseError}
 * on anything that is not a structurally valid event of a known kind, including
 * an event carrying fields its kind does not declare.
 */
export function parseEvent(line: string, upcasters: UpcasterRegistry): CatalogEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    throw new EventParseError(`not valid JSON: ${(error as Error).message}`);
  }
  const versioned = asVersioned(raw);
  const upcast = upcasters.upcast(versioned);
  return validateAndRebuild(upcast);
}

function asVersioned(raw: unknown): VersionedEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EventParseError('event must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.kind !== 'string') {
    throw new EventParseError('event is missing a string "kind"');
  }
  if (typeof obj.v !== 'number' || !Number.isInteger(obj.v) || obj.v < 1) {
    throw new EventParseError(`event "${obj.kind}" has an invalid version`);
  }
  return obj as VersionedEvent;
}

/**
 * Validates a latest-version event against its catalog contract AND returns a
 * freshly rebuilt event containing only the declared fields. Rebuilding — not
 * casting — is what keeps a forged extra/duplicate field out of the signed
 * bytes. A failure here on a freshly written event is a producer bug; on a read
 * event it is a corrupt or forged line.
 */
function validateAndRebuild(event: CatalogEvent): CatalogEvent {
  const envelope = validateEnvelope(event);
  const payload = validatePayload(event);
  return { ...envelope, payload } as CatalogEvent;
}

interface RebuiltEnvelope {
  v: number;
  kind: string;
  at: string;
  who: string;
  signerFp: string;
  subject: string;
  which?: string;
  run?: string;
}

function validateEnvelope(event: CatalogEvent): RebuiltEnvelope {
  rejectUnknownKeys(
    event.kind,
    'event',
    event as unknown as Record<string, unknown>,
    ENVELOPE_FIELDS,
  );
  requireIso8601(event.kind, 'at', event.at);
  requireString(event.kind, 'who', event.who);
  requireString(event.kind, 'signerFp', event.signerFp);
  requireString(event.kind, 'subject', event.subject);
  requireOptionalString(event.kind, 'which', event.which);
  requireOptionalString(event.kind, 'run', event.run);
  const rebuilt: RebuiltEnvelope = {
    v: event.v,
    kind: event.kind,
    at: event.at,
    who: event.who,
    signerFp: event.signerFp,
    subject: event.subject,
  };
  if (event.which !== undefined) rebuilt.which = event.which;
  if (event.run !== undefined) rebuilt.run = event.run;
  return rebuilt;
}

/** A rebuilt payload value: scalars, the valued `null` of a birth, or nested fields. */
type PayloadValue = string | null | TransitionFields;

function validatePayload(event: CatalogEvent): Record<string, PayloadValue> {
  const kind = event.kind;
  requirePayloadObject(event);
  rejectUnknownKeys(
    kind,
    'payload',
    event.payload as unknown as Record<string, unknown>,
    PAYLOAD_FIELDS[kind],
  );
  switch (event.kind) {
    case 'run.started': {
      requireString(kind, 'payload.agent', event.payload.agent);
      requireOptionalString(kind, 'payload.goal', event.payload.goal);
      const p: Record<string, string> = { agent: event.payload.agent };
      if (event.payload.goal !== undefined) p.goal = event.payload.goal;
      return p;
    }
    case 'run.ended': {
      requireOptionalString(kind, 'payload.outcome', event.payload.outcome);
      const p: Record<string, string> = {};
      if (event.payload.outcome !== undefined) p.outcome = event.payload.outcome;
      return p;
    }
    case 'task.created': {
      requireString(kind, 'payload.title', event.payload.title);
      return { title: event.payload.title };
    }
    case 'task.transitioned': {
      requireStringOrNull(kind, 'payload.from', event.payload.from);
      requireString(kind, 'payload.to', event.payload.to);
      requireString(kind, 'payload.action', event.payload.action);
      const p: Record<string, PayloadValue> = {
        from: event.payload.from,
        to: event.payload.to,
        action: event.payload.action,
      };
      const fields = rebuildTransitionFields(kind, event.payload.fields);
      if (fields !== undefined) p.fields = fields;
      return p;
    }
    case 'decision.recorded': {
      requireString(kind, 'payload.title', event.payload.title);
      requireString(kind, 'payload.rationale', event.payload.rationale);
      requireString(kind, 'payload.adr', event.payload.adr);
      return {
        title: event.payload.title,
        rationale: event.payload.rationale,
        adr: event.payload.adr,
      };
    }
    case 'decision.transitioned': {
      requireStringOrNull(kind, 'payload.from', event.payload.from);
      requireString(kind, 'payload.to', event.payload.to);
      requireString(kind, 'payload.action', event.payload.action);
      requireOptionalString(kind, 'payload.by', event.payload.by);
      const p: Record<string, PayloadValue> = {
        from: event.payload.from,
        to: event.payload.to,
        action: event.payload.action,
      };
      if (event.payload.by !== undefined) p.by = event.payload.by;
      const fields = rebuildTransitionFields(kind, event.payload.fields);
      if (fields !== undefined) p.fields = fields;
      return p;
    }
    case 'identity.founded': {
      requireString(kind, 'payload.foundingFp', event.payload.foundingFp);
      return { foundingFp: event.payload.foundingFp };
    }
    case 'key.enrolled': {
      requireString(kind, 'payload.newFp', event.payload.newFp);
      requireString(kind, 'payload.reverseSig', event.payload.reverseSig);
      return { newFp: event.payload.newFp, reverseSig: event.payload.reverseSig };
    }
    case 'key.revoked': {
      requireString(kind, 'payload.revokedFp', event.payload.revokedFp);
      requireString(kind, 'payload.reason', event.payload.reason);
      return { revokedFp: event.payload.revokedFp, reason: event.payload.reason };
    }
    case 'memory.captured': {
      requireString(kind, 'payload.content', event.payload.content);
      return { content: event.payload.content };
    }
    case 'observation.recorded': {
      requireString(kind, 'payload.about', event.payload.about);
      requireString(kind, 'payload.topic', event.payload.topic);
      requireString(kind, 'payload.text', event.payload.text);
      return {
        about: event.payload.about,
        topic: event.payload.topic,
        text: event.payload.text,
      };
    }
    case 'handoff.recorded': {
      requireString(kind, 'payload.fromAgent', event.payload.fromAgent);
      requireString(kind, 'payload.toAgent', event.payload.toAgent);
      return { fromAgent: event.payload.fromAgent, toAgent: event.payload.toAgent };
    }
    case 'knowledge.linked': {
      requireString(kind, 'payload.target', event.payload.target);
      // `rel` is an open literal string: any non-empty string is accepted, never
      // matched against a closed set, so a new relation label needs no upcaster
      // and a past link with an unfamiliar one is never rejected on read.
      requireString(kind, 'payload.rel', event.payload.rel);
      return { target: event.payload.target, rel: event.payload.rel };
    }
    case 'skill.created': {
      requireString(kind, 'payload.name', event.payload.name);
      requireString(kind, 'payload.body', event.payload.body);
      return { name: event.payload.name, body: event.payload.body };
    }
    case 'skill.transitioned': {
      // Mirrors task.transitioned: `from` is a state or the birth's null, and
      // there is no `by` — a skill is not relational.
      requireStringOrNull(kind, 'payload.from', event.payload.from);
      requireString(kind, 'payload.to', event.payload.to);
      requireString(kind, 'payload.action', event.payload.action);
      const p: Record<string, PayloadValue> = {
        from: event.payload.from,
        to: event.payload.to,
        action: event.payload.action,
      };
      const fields = rebuildTransitionFields(kind, event.payload.fields);
      if (fields !== undefined) p.fields = fields;
      return p;
    }
    default:
      // Exhaustiveness: adding a kind without an arm fails the build.
      return assertNever(event);
  }
}

/**
 * Validates and REBUILDS the optional `fields` object of a transition. Like the
 * envelope and payload, `fields` is a closed shape: an unknown key is rejected,
 * and the returned object is a fresh reconstruction of only the declared keys,
 * so a forged extra field cannot ride along into the signed bytes. Returns
 * undefined when `fields` is absent — an omitted key, never `{}`, so a
 * transition with no proof canonicalizes to the same bytes it always did.
 */
function rebuildTransitionFields(kind: string, raw: unknown): TransitionFields | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EventParseError(`event "${kind}" needs an object at payload.fields`);
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(kind, 'payload.fields', obj, TRANSITION_FIELD_KEYS);
  const rebuilt: {
    reason?: string;
    note?: string;
    feedback?: string;
    pr_url?: string;
    links?: string[];
  } = {};
  requireOptionalString(kind, 'payload.fields.reason', obj.reason);
  if (obj.reason !== undefined) rebuilt.reason = obj.reason as string;
  requireOptionalString(kind, 'payload.fields.note', obj.note);
  if (obj.note !== undefined) rebuilt.note = obj.note as string;
  requireOptionalString(kind, 'payload.fields.feedback', obj.feedback);
  if (obj.feedback !== undefined) rebuilt.feedback = obj.feedback as string;
  requireOptionalString(kind, 'payload.fields.pr_url', obj.pr_url);
  if (obj.pr_url !== undefined) rebuilt.pr_url = obj.pr_url as string;
  if (obj.links !== undefined)
    rebuilt.links = requireStringArray(kind, 'payload.fields.links', obj.links);
  // An empty `fields` object carries no proof; treat it as absence so it cannot
  // become a second, byte-distinct spelling of "no fields".
  if (Object.keys(rebuilt).length === 0) {
    throw new EventParseError(`event "${kind}" has an empty payload.fields; omit it instead`);
  }
  return rebuilt;
}

function requireStringArray(kind: string, field: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EventParseError(`event "${kind}" needs a non-empty array at ${field}`);
  }
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new EventParseError(`event "${kind}" needs a non-empty string at ${field}[${i}]`);
    }
    return item;
  });
}

function requirePayloadObject(event: CatalogEvent): void {
  const payload = (event as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new EventParseError(`event "${event.kind}" needs an object payload`);
  }
}

function rejectUnknownKeys(
  kind: string,
  where: string,
  obj: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new EventParseError(`event "${kind}" has an unknown ${where} field "${key}"`);
    }
  }
}

function requireString(kind: string, field: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EventParseError(`event "${kind}" needs a non-empty string at ${field}`);
  }
}

function requireOptionalString(kind: string, field: string, value: unknown): void {
  if (value !== undefined) requireString(kind, field, value);
}

/** Requires a non-empty string or an explicit `null` (a valued absence). */
function requireStringOrNull(kind: string, field: string, value: unknown): void {
  if (value === null) return;
  requireString(kind, field, value);
}

/**
 * The exact shape `Date.prototype.toISOString` produces: UTC, millisecond
 * precision, trailing `Z`. Every producer stamps `at` through the clock, which
 * IS `toISOString` — so a well-formed `at` is not merely "some ISO-8601 string"
 * but this one canonical spelling. Pinning it here makes the ordering invariant
 * (the k-way merge sorts by `at`) enforceable rather than merely documented: a
 * timezone offset, a missing/extra sub-second digit, or a non-date is a corrupt
 * or forged line, not a fact this catalog wrote.
 */
const ISO8601_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Requires a non-empty string in the canonical `toISOString` form that is a real instant. */
function requireIso8601(kind: string, field: string, value: unknown): void {
  requireString(kind, field, value);
  const at = value as string;
  // Shape AND value: the regex fixes the spelling; the round-trip rejects an
  // impossible date (e.g. month 13, day 32) that still matches the pattern —
  // such a value makes `new Date` yield an invalid date whose toISOString throws.
  let roundTrip: string | null = null;
  if (ISO8601_UTC_MS.test(at)) {
    try {
      roundTrip = new Date(at).toISOString();
    } catch {
      roundTrip = null;
    }
  }
  if (roundTrip !== at) {
    throw new EventParseError(
      `event "${kind}" needs an ISO-8601 UTC millisecond timestamp at ${field} (got ${JSON.stringify(value)})`,
    );
  }
}

function assertNever(value: never): never {
  throw new EventParseError(`unhandled event kind: ${JSON.stringify(value)}`);
}

/**
 * Views a catalog event as a canonicalizable value. An event that came from
 * {@link parseEvent} or a builder is by construction a tree of strings,
 * numbers, and nested objects with only declared fields — exactly what
 * canonicalization accepts — so this is a narrowing, not a transform. Keeping
 * it in one place means the bytes signed are unambiguously "the whole event".
 */
export function toCanonical(event: CatalogEvent): CanonicalValue {
  return event as unknown as CanonicalValue;
}
