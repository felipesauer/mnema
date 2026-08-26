/**
 * The field declarations, as DATA — the one place a kind says which fields it
 * carries, and the only thing the reader rebuilds an event from.
 *
 * `FORMAT.md` section 4 has always promised that "a reader rebuilds the event
 * from the fields its kind declares and rejects any other". Until this module
 * existed, those declarations were a `switch` of twenty arms inside `parse.ts`
 * and a key list beside it — readable by this codebase and by nothing else. An
 * independent verifier written from the document measured the consequence: an
 * event APPENDED above the last checkpoint with a field no kind declares was
 * read as verified by a stranger and as unreadable by this product. The entry
 * hash takes no key, so whoever can write the repository computes it; no
 * signature covers that window; and the envelope keys are all present. The only
 * thing that could have refused it was the declaration, and the declaration was
 * not published.
 *
 * So the declarations became data, and the data is published:
 * `event-schema.json` beside `FORMAT.md`, described by section 4.1.
 *
 * ONE SOURCE, AND WHY IT HAD TO BE THIS ONE. A hand-written schema beside a
 * hand-written reader is two places where the fields live, and two places drift
 * — silently, because the day they disagree is the day the second reader starts
 * accepting what this one refuses again, with nothing red. So the table below is
 * not a description of the reader: it IS the reader. `parse.ts` walks these rows
 * and has no per-kind branch left, and the published artifact is this table
 * serialized. A field that is not here is a field nothing validates, rebuilds,
 * or publishes.
 *
 * THE COMPILER HOLDS THE TOTALITY, and it holds it here in `src` rather than in
 * a test: `tsc -b` excludes `src/**\/*.test.ts` and vitest strips types without
 * checking them, so a mapped type declared in a test file is vacuous by
 * construction. {@link PAYLOAD_SCHEMA} is keyed by {@link EventKind}, so a new
 * kind does not compile until it has a row; each row is keyed by the payload's
 * own field names, so a field added to, renamed in, or removed from the catalog
 * does not compile until the row follows. That is stronger than the key list it
 * replaces, which was keyed by kind alone and let a field appear in an arm and
 * nowhere else.
 *
 * WHAT A RULE IS. A rule is one of a small closed vocabulary
 * ({@link FieldRule}), spelled the same way in this table and in the published
 * artifact, because a stranger has to be able to read it. The vocabulary is
 * small on purpose: every payload field of the catalog falls into six shapes,
 * and a seventh would be a decision somebody makes rather than a convenience
 * somebody reaches for.
 */

import type { CatalogEvent, EventKind, TransitionFields } from './catalog.js';
import type { Envelope } from './envelope.js';

/**
 * The vocabulary a payload field rule is spelled in.
 *
 * Each name is a refusal as much as a shape — the point of a closed catalog is
 * that a value which is ALMOST the right shape is a line two readers could
 * disagree about, so each rule below says exactly one thing and coerces nothing:
 *
 * - `string` — present, and a non-empty string.
 * - `string?` — absent, or a non-empty string. Absent is not `null` and not `""`.
 * - `string|null` — present, and either a non-empty string or an explicit `null`.
 *   The `null` is a VALUED absence (the state a birth transition left behind),
 *   which is why it is a spelling of its own rather than an optional.
 * - `boolean` — present, and exactly `true` or `false`. Nothing is coerced:
 *   `"false"`, `0` and `null` are all falsy in this language and none of them is
 *   the position of a switch.
 * - `count` — present, and a whole number of at least one. Every way a number can
 *   be almost-a-number (a float, a `-0`, a `1e3`, a NaN) is a way two readers
 *   could disagree about the same line.
 * - `fields?` — absent, or the transition-proof object declared by
 *   {@link TRANSITION_FIELDS_SCHEMA}, closed the same way and never empty.
 * - `string[]?` — absent, or a non-empty array of non-empty strings.
 */
export type FieldRule =
  | 'string'
  | 'string?'
  | 'string|null'
  | 'boolean'
  | 'count'
  | 'fields?'
  | 'string[]?';

/**
 * The vocabulary an ENVELOPE field rule is spelled in: the payload vocabulary
 * plus the two shapes only the envelope has.
 *
 * - `version` — a whole number of at least one, selecting the payload contract
 *   together with `kind`.
 * - `kind` — the discriminator itself: a non-empty string naming a declared kind.
 * - `instant` — the exact spelling `Date.prototype.toISOString` produces (UTC,
 *   millisecond precision, trailing `Z`) AND a real date. Every producer stamps
 *   `at` through the clock, which IS `toISOString`, so a well-formed `at` is not
 *   merely "some ISO-8601 string" but this one canonical spelling — which is what
 *   makes the ordering invariant enforceable rather than merely documented.
 */
export type EnvelopeRule = FieldRule | 'version' | 'kind' | 'instant';

/**
 * The envelope every kind carries, and the rule on each field.
 *
 * Keyed by `keyof Required<Envelope>`, so a field added to the envelope does not
 * compile until it is declared here — and therefore until it is published.
 *
 * THE ORDER HERE IS OBSERVABLE, which is not obvious and was measured. Canonical
 * bytes sort their keys (§1), so the order cannot move a digest — but the rebuilt
 * event is what a surface prints, and `JSON.stringify` keeps insertion order. So
 * this is the order an agent reading `--json` sees, and it is pinned by
 * `packages/code/src/cli.golden.test.ts`. It is the six required fields, in the
 * order the reader validates them, and then the two optional ones — which is both
 * what the product has always emitted and the more legible half-and-half for
 * somebody reading the published file.
 */
export const ENVELOPE_SCHEMA: { readonly [F in keyof Required<Envelope>]: EnvelopeRule } = {
  v: 'version',
  kind: 'kind',
  at: 'instant',
  who: 'string',
  signerFp: 'string',
  subject: 'string',
  which: 'string?',
  run: 'string?',
};

/**
 * The proof/context object a transition may carry.
 *
 * Every field is optional and the object is never empty: an empty `fields` carries
 * no proof, so treating it as absence is what stops it becoming a second,
 * byte-distinct spelling of "no fields".
 */
export const TRANSITION_FIELDS_SCHEMA: {
  readonly [F in keyof Required<TransitionFields>]: FieldRule;
} = {
  reason: 'string?',
  note: 'string?',
  feedback: 'string?',
  pr_url: 'string?',
  links: 'string[]?',
};

/** The payload contract of one kind: every declared field, with its rule. */
type PayloadSchemaOf<K extends EventKind> = {
  readonly [F in keyof Required<Extract<CatalogEvent, { kind: K }>['payload']>]: FieldRule;
};

/**
 * What each kind declares, and nothing else may ride along.
 *
 * The row order is the catalog's own kind order, and the field order within a row
 * is the order the reader validates in — which is what a reader's first refusal
 * names when a line is wrong in more than one way.
 */
export const PAYLOAD_SCHEMA: { readonly [K in EventKind]: PayloadSchemaOf<K> } = {
  'run.started': { agent: 'string', goal: 'string?' },
  'run.ended': { outcome: 'string?' },
  'task.created': { title: 'string' },
  'task.transitioned': {
    from: 'string|null',
    to: 'string',
    action: 'string',
    fields: 'fields?',
  },
  // `alternatives` is declared OPTIONAL, and that is a fact about the past rather
  // than a convenience: a decision recorded before the field existed omits it,
  // parses, and canonicalizes to exactly the bytes it was signed as. A schema that
  // published one exemplar per kind could never say this — which is the half of a
  // declaration a stranger cannot infer from an example.
  'decision.recorded': {
    title: 'string',
    rationale: 'string',
    adr: 'string',
    alternatives: 'string?',
  },
  'decision.transitioned': {
    from: 'string|null',
    to: 'string',
    action: 'string',
    by: 'string?',
    fields: 'fields?',
  },
  'identity.founded': { foundingFp: 'string' },
  'key.enrolled': { newFp: 'string', reverseSig: 'string' },
  'key.revoked': { revokedFp: 'string', reason: 'string' },
  'memory.captured': { content: 'string' },
  'observation.recorded': { about: 'string', topic: 'string', text: 'string' },
  'handoff.recorded': { fromAgent: 'string', toAgent: 'string' },
  // `rel` is an open literal string: any non-empty string is accepted, never
  // matched against a closed set, so a new relation label needs no upcaster and a
  // past link with an unfamiliar one is never rejected on read.
  'knowledge.linked': { target: 'string', rel: 'string' },
  'skill.created': { name: 'string', body: 'string' },
  // Mirrors task.transitioned: `from` is a state or the birth's null, and there is
  // no `by` — a skill is not relational.
  'skill.transitioned': {
    from: 'string|null',
    to: 'string',
    action: 'string',
    fields: 'fields?',
  },
  // No payload field at all: a consultation is entirely envelope. The empty row is
  // what makes ANY payload key on this kind a rejected line.
  'skill.consulted': {},
  'tail.pruned': {
    tail: 'string',
    throughHash: 'string',
    // The catalog's first numeric payload field, and the rule on it is the reader's
    // alone: a count of events in a tail that no longer exists is a claim nothing on
    // disk can be compared against once the cut has happened, so what CAN be said is
    // that it is a whole number of at least one. Zero is refused because a tail with
    // no events has no head to name either.
    // WHAT IS DELIBERATELY NOT DECLARED: whether the named tail is on disk. That is
    // the WRITE-side rule (see `unprovenWaiverReason`), and it must never become a
    // read-side one — the waiver exists to survive the cut, so the moment the tail it
    // names is gone, a reader applying the write rule would refuse the waiver, and
    // refusing one line refuses the whole tail it lives on, permanently.
    eventCount: 'count',
    reason: 'string',
  },
  // The catalog's only BOOLEAN, and the rule is that it is one: a `"off"`, a `0` or
  // a missing key are three ways for two readers to disagree about whether a channel
  // was on, and this kind is read to decide whether the product says anything at all.
  'channel.switched': { on: 'boolean', reason: 'string?' },
  // No payload field at all, the same as a consultation: the fact is entirely envelope.
  'channel.served': {},
  // Both are REQUIRED, and the rule especially: this is the one kind of the catalog
  // whose whole standing is that it names what caused it, so a charge with an absent
  // or empty citation is a line this reader refuses rather than one it lifts.
  'channel.asked': { rule: 'string', path: 'string' },
};

/**
 * What each rule name MEANS, in one line, carried inside the published artifact.
 *
 * The artifact is for a reader who has only the artifact and the document, so it
 * carries its own glossary rather than only rule names. The normative text is
 * `FORMAT.md` section 4.1 — this is the same sentence, travelling with the data,
 * so a file that arrives on its own is still readable. It is derived from one
 * table here for the same reason everything else in this module is: a glossary
 * that could disagree with the vocabulary is a second place the rules live.
 */
export const RULE_GLOSSARY: { readonly [R in EnvelopeRule]: string } = {
  string: 'present, and a non-empty string',
  'string?': 'absent, or a non-empty string; absent is not null and not the empty string',
  'string|null': 'present, and either a non-empty string or an explicit null',
  boolean: 'present, and exactly true or false; nothing is coerced',
  count: 'present, and a whole number of at least 1',
  'fields?': 'absent, or the transitionFields object below, closed the same way and never empty',
  'string[]?': 'absent, or a non-empty array of non-empty strings',
  version: 'present, and a whole number of at least 1; with kind it selects this contract',
  kind: 'present, and the non-empty string naming this contract',
  instant:
    'present, and the exact spelling Date.prototype.toISOString produces ' +
    '(UTC, millisecond precision, trailing Z) of a real date',
};

/** One published contract: the payload a `(kind, v)` pair declares. */
export interface PublishedContract {
  readonly kind: string;
  readonly v: number;
  readonly payload: { readonly [field: string]: FieldRule };
}

/** The published artifact, as data. */
export interface PublishedSchema {
  readonly schemaVersion: number;
  readonly describedBy: string;
  readonly rules: { readonly [rule: string]: string };
  readonly envelope: { readonly [field: string]: EnvelopeRule };
  readonly transitionFields: { readonly [field: string]: FieldRule };
  readonly contracts: readonly PublishedContract[];
}

/**
 * The published schema, built from the tables above and from nothing else.
 *
 * `kind` and `v` TOGETHER select one contract, which is the pair section 7
 * already made every event carry and the pair the interoperability world settles
 * this with (in-toto's `predicateType` is a URI carrying the major version, and
 * it changes when the change is incompatible). A contract list rather than a map
 * keyed by kind, because that is the shape a second version grows into: one more
 * row, not a reshaped file.
 *
 * The rows are sorted by `(kind, v)` so the file has one order, and the order is
 * not the declaration order of a table somebody may reorder.
 */
export function publishedSchema(latest: { readonly [kind: string]: number }): PublishedSchema {
  const contracts = Object.entries(PAYLOAD_SCHEMA)
    .map(([kind, payload]) => ({
      kind,
      v: latest[kind] ?? 1,
      payload: payload as { readonly [field: string]: FieldRule },
    }))
    .sort((a, b) => (a.kind === b.kind ? a.v - b.v : a.kind < b.kind ? -1 : 1));
  return {
    schemaVersion: 1,
    describedBy: 'FORMAT.md',
    rules: RULE_GLOSSARY,
    envelope: ENVELOPE_SCHEMA,
    transitionFields: TRANSITION_FIELDS_SCHEMA,
    contracts,
  };
}

/**
 * Where the published artifact is, resolved from this module.
 *
 * ONE site for the path, the same discipline `vectors.ts` states for the other
 * artifact: the test that checks the file, the guard that checks `FORMAT.md`, and
 * the sentence in `FORMAT.md` that tells a stranger where to find it all have to
 * name the same file. The depth is the same from `src/events/` and from
 * `dist/events/`, so it resolves in the suite and in the built package.
 */
export const SCHEMA_FILE_NAME = 'event-schema.json';
export const SCHEMA_FILE = new URL(`../../${SCHEMA_FILE_NAME}`, import.meta.url);

/**
 * The artifact's bytes, exactly as the file holds them: two-space JSON with a
 * trailing newline.
 *
 * Written out here rather than left to a test, because the file and the table are
 * checked BYTE for byte — a serializer that disagreed with the file's formatting
 * would make the guard fail for a reason that is not drift, and somebody would
 * "fix" it by loosening the comparison.
 */
export function publishedSchemaText(latest: { readonly [kind: string]: number }): string {
  return `${JSON.stringify(publishedSchema(latest), null, 2)}\n`;
}
