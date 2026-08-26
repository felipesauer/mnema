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
 * kind declares. WHAT A KIND DECLARES LIVES IN `schema.ts` AND NOWHERE ELSE —
 * this module walks that table and has no per-kind branch of its own, and the
 * published `event-schema.json` is the same table serialized. It used to be a
 * `switch` of twenty arms here, which is why the declarations could be promised
 * by `FORMAT.md` section 4 and published by nothing: a second reader had no way
 * to know them, and measurably accepted an appended event carrying a field no
 * kind declares. Parsing rebuilds the event from exactly the declared fields, so
 * a forged line cannot smuggle extra data past validation and have it ride along
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
import {
  ENVELOPE_SCHEMA,
  type EnvelopeRule,
  type FieldRule,
  PAYLOAD_SCHEMA,
  TRANSITION_FIELDS_SCHEMA,
} from './schema.js';
import type { UpcasterRegistry, VersionedEvent } from './upcaster.js';

/** Thrown when a line is not a valid, current-catalog event. */
export class EventParseError extends Error {
  override readonly name = 'EventParseError';
}

/**
 * The top-level fields a stored line may carry: the envelope the schema declares,
 * plus `payload`, which is the only top-level key that is not an envelope field.
 *
 * Derived from {@link ENVELOPE_SCHEMA} rather than typed out again, so an envelope
 * field added there is accepted here without a second edit — the shape that used
 * to be two lists is one.
 */
const ENVELOPE_FIELDS: readonly string[] = [...Object.keys(ENVELOPE_SCHEMA), 'payload'];

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

/**
 * Why reading would refuse this event, or undefined when it would accept it —
 * the question a WRITER has to ask before it seals anything.
 *
 * It runs {@link validateAndRebuild}, the very function {@link parseEvent} runs,
 * and that identity is the whole point rather than an implementation detail. The
 * rule "a title is a non-empty string" existed here and nowhere on the writing
 * side, so a write accepted what every later read refused — and on an append-only
 * log that is not a bad record, it is a record that can never be opened again: one
 * unreadable entry fails the replay for the WHOLE tree, and nothing can take it
 * back out. A second copy of the rule on the writing side would have closed the
 * case of the day and re-opened it the first time the two copies drifted, which is
 * a defect this codebase has caught more than once. So the writing side asks the
 * reading side, and the two cannot disagree because there is only one of them.
 *
 * It answers with DATA — the reader's own message, naming the field — because the
 * two callers need it in two shapes: the writer turns it into a throw (a producer
 * bug, loud), and a surface turns it into a typed refusal a person or an agent can
 * read and act on.
 *
 * The rebuilt event is discarded: the writer's builders already produce exactly
 * the declared fields, so there is nothing to strip, and the question here is only
 * whether the reader would accept these bytes.
 */
export function unreadableReason(event: CatalogEvent): string | undefined {
  try {
    validateAndRebuild(event);
    return undefined;
  } catch (error) {
    if (error instanceof EventParseError) return error.message;
    throw error;
  }
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

/**
 * The rebuilt envelope: every declared envelope field that was present, and
 * nothing else. Typed loosely on purpose — the shape is the schema's, and naming
 * the fields a second time here is the second list this delivery removed.
 */
type RebuiltEnvelope = Record<string, string | number>;

/**
 * A rebuilt payload value: scalars, the valued `null` of a birth, or nested fields.
 */
type PayloadValue = string | number | boolean | null | readonly string[] | TransitionFields;

/**
 * What a rule answers when the field was legitimately absent.
 *
 * A sentinel rather than `undefined`, because `undefined` is also what a present
 * field holding nothing would read as, and the two must not merge: an omitted key
 * is rebuilt as an omitted key, while a present `undefined` is a value section 1
 * refuses outright.
 */
const ABSENT = Symbol('absent');

/**
 * Applies ONE rule to ONE field, and answers the value to rebuild with — or
 * {@link ABSENT} when the field was legitimately omitted.
 *
 * This is the single site of every field rule in the catalog. It is the function
 * both the reader and the writer reach (through {@link unreadableReason}), and it
 * is the function the published `event-schema.json` names a rule FOR: a stranger
 * reading the artifact reads a rule name, and this is what that name means.
 */
function applyRule(
  kind: string,
  field: string,
  rule: EnvelopeRule,
  value: unknown,
): PayloadValue | typeof ABSENT {
  switch (rule) {
    case 'string':
      requireString(kind, field, value);
      return value as string;
    case 'string?':
      if (value === undefined) return ABSENT;
      requireString(kind, field, value);
      return value as string;
    case 'string|null':
      requireStringOrNull(kind, field, value);
      return value as string | null;
    case 'boolean':
      requireBoolean(kind, field, value);
      return value as boolean;
    case 'count':
      requirePositiveInteger(kind, field, value);
      return value as number;
    case 'string[]?':
      if (value === undefined) return ABSENT;
      return requireStringArray(kind, field, value);
    case 'fields?': {
      const fields = rebuildTransitionFields(kind, value);
      return fields === undefined ? ABSENT : fields;
    }
    case 'version':
      requireVersion(kind, field, value);
      return value as number;
    case 'kind':
      requireString(kind, field, value);
      return value as string;
    case 'instant':
      requireIso8601(kind, field, value);
      return value as string;
    default:
      // Exhaustiveness: a rule added to the vocabulary without an arm fails the build,
      // which is what keeps the published vocabulary and this reader the same size.
      return assertNeverRule(rule);
  }
}

function validateEnvelope(event: CatalogEvent): RebuiltEnvelope {
  rejectUnknownKeys(
    event.kind,
    'event',
    event as unknown as Record<string, unknown>,
    ENVELOPE_FIELDS,
  );
  const raw = event as unknown as Record<string, unknown>;
  const rebuilt: RebuiltEnvelope = {};
  for (const [field, rule] of Object.entries(ENVELOPE_SCHEMA)) {
    const value = applyRule(event.kind, field, rule, raw[field]);
    if (value !== ABSENT) rebuilt[field] = value as string | number;
  }
  return rebuilt;
}

/**
 * Validates and rebuilds the payload against exactly what its kind declares.
 *
 * There is no per-kind branch here and there is not meant to be one: the branch
 * WAS the reason the declarations could not be published, and a reader that
 * walks a table is a reader whose table can be handed to somebody else.
 */
function validatePayload(event: CatalogEvent): Record<string, PayloadValue> {
  const kind = event.kind;
  requirePayloadObject(event);
  const declared = PAYLOAD_SCHEMA[kind] as Record<string, FieldRule> | undefined;
  if (declared === undefined) {
    throw new EventParseError(`unhandled event kind: ${JSON.stringify(kind)}`);
  }
  const raw = event.payload as unknown as Record<string, unknown>;
  rejectUnknownKeys(kind, 'payload', raw, Object.keys(declared));
  const rebuilt: Record<string, PayloadValue> = {};
  for (const [field, rule] of Object.entries(declared)) {
    const value = applyRule(kind, `payload.${field}`, rule, raw[field]);
    if (value !== ABSENT) rebuilt[field] = value;
  }
  return rebuilt;
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
  rejectUnknownKeys(kind, 'payload.fields', obj, Object.keys(TRANSITION_FIELDS_SCHEMA));
  const rebuilt: Record<string, PayloadValue> = {};
  for (const [field, rule] of Object.entries(TRANSITION_FIELDS_SCHEMA)) {
    const value = applyRule(kind, `payload.fields.${field}`, rule, obj[field]);
    if (value !== ABSENT) rebuilt[field] = value;
  }
  // An empty `fields` object carries no proof; treat it as absence so it cannot
  // become a second, byte-distinct spelling of "no fields".
  if (Object.keys(rebuilt).length === 0) {
    throw new EventParseError(`event "${kind}" has an empty payload.fields; omit it instead`);
  }
  return rebuilt as TransitionFields;
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

/**
 * Requires a whole number of at least one.
 *
 * A count is the one payload value in this catalog that is not text, and every way
 * a number can be almost-a-number is a way two readers could disagree about the
 * same line: a float, a `-0`, a `1e3`, a NaN. Canonicalization already refuses the
 * non-finite ones; this refuses the rest, so a count that reached the chain is a
 * count that means what it says.
 */
function requirePositiveInteger(kind: string, field: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new EventParseError(`event "${kind}" needs a whole number of at least 1 at ${field}`);
  }
}

/**
 * Requires exactly a boolean.
 *
 * Nothing is coerced, deliberately: `"false"`, `0` and `null` are all falsy in this
 * language and none of them is a position of a switch. A line that spelled the state
 * any other way was not written by a builder here, and reading it as "off" would let
 * a forged or truncated line silence the product.
 */
function requireBoolean(kind: string, field: string, value: unknown): void {
  if (typeof value !== 'boolean') {
    throw new EventParseError(`event "${kind}" needs true or false at ${field}`);
  }
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

/**
 * Requires the version selector: a whole number of at least one.
 *
 * `kind` and `v` together select exactly one payload contract (section 7), so a
 * version that is not a whole number is not a selector at all — it names no
 * contract, and a reader that let it through would be rebuilding against a
 * contract it picked rather than one the line named.
 */
function requireVersion(kind: string, field: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new EventParseError(`event "${kind}" needs a whole number of at least 1 at ${field}`);
  }
}

/**
 * Exhaustiveness over the RULE vocabulary, not over the kinds.
 *
 * The kinds are held by {@link PAYLOAD_SCHEMA}'s mapped type — a kind with no row
 * does not compile. What this holds is the other half: a rule name added to
 * {@link FieldRule} and published in `event-schema.json` with nothing here to
 * apply it would be a rule a stranger implements and this reader ignores.
 */
function assertNeverRule(rule: never): never {
  throw new EventParseError(`unhandled field rule: ${JSON.stringify(rule)}`);
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
