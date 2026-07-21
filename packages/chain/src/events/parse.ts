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
import type { CatalogEvent } from './catalog.js';
import type { UpcasterRegistry, VersionedEvent } from './upcaster.js';

/** Thrown when a line is not a valid, current-catalog event. */
export class EventParseError extends Error {
  override readonly name = 'EventParseError';
}

/** The envelope fields every kind carries, in canonical membership. */
const ENVELOPE_FIELDS = ['v', 'kind', 'at', 'who', 'which', 'run', 'subject', 'payload'] as const;

/** The payload fields each kind declares. Anything else is rejected. */
const PAYLOAD_FIELDS: { readonly [K in CatalogEvent['kind']]: readonly string[] } = {
  'run.started': ['agent', 'goal'],
  'run.ended': ['outcome'],
  'task.created': ['title'],
  'task.transitioned': ['from', 'to', 'action'],
};

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
  requireString(event.kind, 'at', event.at);
  requireString(event.kind, 'who', event.who);
  requireString(event.kind, 'subject', event.subject);
  requireOptionalString(event.kind, 'which', event.which);
  requireOptionalString(event.kind, 'run', event.run);
  const rebuilt: RebuiltEnvelope = {
    v: event.v,
    kind: event.kind,
    at: event.at,
    who: event.who,
    subject: event.subject,
  };
  if (event.which !== undefined) rebuilt.which = event.which;
  if (event.run !== undefined) rebuilt.run = event.run;
  return rebuilt;
}

function validatePayload(event: CatalogEvent): Record<string, string | null> {
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
      return { from: event.payload.from, to: event.payload.to, action: event.payload.action };
    }
    default:
      // Exhaustiveness: adding a kind without an arm fails the build.
      return assertNever(event);
  }
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
