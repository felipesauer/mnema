/**
 * What every text field of the catalog IS — prose a caller wrote, or an
 * identifier the record derived — and therefore which of them the content door
 * owes a pass over.
 *
 * WHY THIS EXISTS, MEASURED. The door is one function called from every write
 * point, and a test drives every write point and reads the whole chain back. That
 * proves the door ran on the text it was GIVEN; it does not prove the text reached
 * it, because the CALLER picks which fields to hand over. The gap was measured, not
 * feared: `alternatives` was added to `decision.recorded` with the screen
 * deliberately bypassed and the whole suite stayed green, `every-door.test.ts`
 * included, ten of ten. A guard over POINTS cannot see a missing FIELD — the driving
 * that would catch one was itself a hand-written list of arguments, so the test and
 * the production code forgot the same field together.
 *
 * So the guard has to be total over the fields, and a field-total guard needs one
 * thing that did not exist anywhere: a way to say which strings are text at all.
 * Not every string in a payload is something a person wrote — there are minted ids,
 * key fingerprints, workflow states, a frozen citation label, an instant — and
 * running any of those through a scrubber is not a weaker defense, it is DAMAGE.
 * That is the same finding the scrubber itself is built on: over a real archive of
 * 4,277 events an entropy rule flagged 13,094 values, of which 8,208 were
 * fingerprints and 3,649 were ids, against 0 for a known-prefix rule. A door that
 * eats the record's own identity leaves it unreadable and still not safe.
 *
 * THE RULE, IN ONE SENTENCE. A field is PROSE when the value the chain stores is
 * one the CALLER supplied and this package never proved anything about; it is an
 * IDENTIFIER when the value is derived here (a mint, a key, the clock, a gate's
 * verdict, a closed vocabulary) or was looked up in the record before being stored.
 *
 * The second half of that sentence is what puts the REFERENCE fields on the prose
 * side, which surprises until it is read twice. An observation's `about`, a link's
 * `target`, a handoff's task, a consultation's skill: each is an id BY CONTRACT and
 * none of them is validated — a dangling cross-tree reference is honest here — so in
 * practice each holds whatever a caller sent, and each has gone through the door for
 * as long as the door has existed. A transition's subject is the opposite case in
 * the same shape: it is a caller's string too, but the operation refuses it unless
 * the projection already holds it, so what gets stored came out of the record.
 * "Validated against the record" is the line, not "named like an id".
 *
 * WHAT THE TWO HALVES OBLIGE, and they are not two flavours of the same thing:
 *   - PROSE must reach `screenContent` before it reaches the chain. A field
 *     classified prose that no operation screens is a credential recorded verbatim.
 *   - IDENTIFIER must reach the chain UNTOUCHED. A fingerprint is compared, a
 *     reverse-signature is verified byte for byte, an id is a lookup key: a
 *     placeholder in any of them breaks the thing the record exists to prove. So
 *     the guard asserts the door did NOT run on these, which is the half that keeps
 *     it from turning into the damage it is defending against.
 *
 * HOW TOTALITY IS OBTAINED — from the catalog's own declarations, never a list kept
 * in step by hand. {@link TextPath} reads the payload interfaces themselves, so the
 * keys of each table below are exactly the text-valued leaves the catalog declares,
 * nested ones included (a transition's `fields.reason` is a key here, at that
 * spelling). A field added to a payload appears in this file's REQUIRED keys the
 * moment it is declared, and the build fails until it is classified. That is the
 * `Exclude<EventKind, RoutedKind>` mould of the routing table, applied one level
 * down: to the fields rather than the kinds.
 *
 * WHAT IT DOES NOT REACH, said out loud so a pass is not read as more than it is:
 * a payload field that is neither text nor an object of text (a number, a boolean)
 * is not classified, because there is nothing for a door to do to it. A list of
 * OBJECTS would not be addressed by a dotted path either — no payload has one, and
 * the day one is declared this file stops compiling rather than skipping it in
 * silence, which is the failure mode worth having.
 *
 * NOT ON THE PACKAGE'S PUBLIC SURFACE, deliberately, and for the reason
 * `UNROUTED_KINDS` is not: nothing outside asks what nature a field has, the value
 * of the tables is the compile-time obligation they place on the catalog, and the
 * proof that consumes them lives next door in `every-door.test.ts`. Hiding them
 * costs the proof nothing. That all three stay hidden is checked and not merely
 * declared: `no-classification-table-reaches-the-surface.test.ts` finds this module
 * by the sentence above and asserts that none of its tables is a runtime export of
 * any entry point.
 */

import type { CatalogEvent, Envelope, EventKind } from '@mnema/chain';

/**
 * What a field's value is, and therefore what the door owes it: text a caller
 * wrote (screen it), or a value the record derived or proved (leave it alone).
 */
export type FieldNature = 'prose' | 'identifier';

/** A value the content door can act on: one text field, or a list of them. */
type TextLeaf = string | readonly string[];

/**
 * The dotted paths of every text-valued leaf a shape declares — the enumeration
 * the tables below are keyed by.
 *
 * It reads the TYPE, which is the catalog's source of truth, so it cannot fall out
 * of step with what a builder can produce. A leaf is a string or a list of strings
 * (both are what `screenContent` takes); an object is descended into and its
 * leaves come back prefixed (`fields.reason`); anything else contributes nothing.
 * Optionality is stripped first, so an optional field is enumerated exactly like a
 * required one — the door's obligation does not depend on whether the caller had to
 * supply the value.
 */
type TextPath<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends TextLeaf
    ? K
    : NonNullable<T[K]> extends object
      ? `${K}.${TextPath<NonNullable<T[K]>>}`
      : never;
}[keyof T & string];

/** The payload a kind declares, selected from the catalog union by its `kind`. */
type PayloadOf<K extends EventKind> = Extract<CatalogEvent, { readonly kind: K }>['payload'];

/**
 * The text leaves of a kind's payload, or none for a kind that declares no payload
 * field at all.
 *
 * The guard on the left is what keeps `skill.consulted` honest: its payload is
 * `Record<string, never>`, whose `keyof` is `string` rather than a union of
 * literals, and a mapped type over it would collapse into an index signature that
 * accepts anything. Read as "declares no named field", it yields no keys — so the
 * table entry must be empty, and the day that kind grows a real field the union
 * becomes literal and the field is required here like every other.
 */
type PayloadPath<K extends EventKind> = string extends keyof PayloadOf<K>
  ? never
  : TextPath<PayloadOf<K>>;

/**
 * The envelope's text fields, classified once — the envelope is the same on every
 * kind, which is the whole reason it is an envelope.
 *
 * `subject` is the exception and is excluded here rather than fudged: it is the one
 * envelope field whose nature depends on the kind (see {@link SUBJECT_TEXT}), so a
 * single answer for it would be wrong for half the catalog.
 *
 * `which` is prose and has been screened since the day it was found unscreened. `run`
 * is prose for exactly the same reasons and is the one this classification FOUND: it
 * is a caller's string, this package proves nothing about it, it has no size ceiling
 * of its own, and — like `which` — it is stamped on EVERY event of a session, so one
 * bad value is as many disclosures as the session has facts. The surfaces do prove it
 * (the CLI resolves `MNEMA_RUN` against the record before any write, the MCP server
 * fills it from the session it opened itself), which is precisely the argument this
 * codebase already rejected for the consultation's skill id: an invariant enforced
 * only where someone remembered it is a habit, not a property.
 *
 * The other four are derived and must survive verbatim: `kind` comes from the
 * builder, `at` from the clock, `who` from the writing key, `signerFp` from that same
 * key. `v` is a number and is no field of this table — there is nothing textual to
 * screen.
 */
export const ENVELOPE_TEXT: {
  readonly [P in Exclude<TextPath<Envelope>, 'subject'>]: FieldNature;
} = {
  kind: 'identifier',
  at: 'identifier',
  who: 'identifier',
  signerFp: 'identifier',
  which: 'prose',
  run: 'prose',
};

/**
 * What the SUBJECT of each kind is — the one envelope field the kind decides.
 *
 * Three shapes, and the difference between them is where the stored value came
 * from, never what it is named:
 *   - MINTED here (`task.created`, `decision.recorded`, `memory.captured`,
 *     `observation.recorded`, `skill.created`, `run.started`) — an id this package
 *     generated, so no caller can put anything in it.
 *   - PROVED against the record (every `*.transitioned`, `run.ended`) — a caller's
 *     string, but the operation refuses it unless the projection already holds it,
 *     so what is stored is the record's own key.
 *   - DERIVED from a key (the three identity kinds) — the anchor, computed.
 *   - The caller's REFERENCE, unproved (`handoff.recorded`, `knowledge.linked`,
 *     `skill.consulted`) — the subject IS a string a caller sent and nothing here
 *     confirms, so it is prose and goes through the door, which is what those three
 *     operations already do.
 */
export const SUBJECT_TEXT: { readonly [K in EventKind]: FieldNature } = {
  'run.started': 'identifier',
  'run.ended': 'identifier',
  'task.created': 'identifier',
  'task.transitioned': 'identifier',
  'decision.recorded': 'identifier',
  'decision.transitioned': 'identifier',
  'identity.founded': 'identifier',
  'key.enrolled': 'identifier',
  'key.revoked': 'identifier',
  'memory.captured': 'identifier',
  'observation.recorded': 'identifier',
  'handoff.recorded': 'prose',
  'knowledge.linked': 'prose',
  'skill.created': 'identifier',
  'skill.transitioned': 'identifier',
  'skill.consulted': 'prose',
  // DERIVED from the record: the anchor a waiver names is read off the pruned
  // tail's own last event, never handed in. No caller can put anything in it.
  'tail.pruned': 'identifier',
};

/**
 * Every text leaf of every payload the catalog declares, classified — the table the
 * guard next door derives its poisoning from.
 *
 * The identifiers here are worth reading as a group, because they are the reason the
 * classification is two-sided rather than "screen everything":
 *   - `from` / `to` / `action` are the workflow's own literals, resolved from the
 *     gate's verdict and never from the caller's assertion.
 *   - `by` on a supersede is a decision id the operation refused to record until the
 *     projection proved it exists.
 *   - `adr` is derived from a count at write time and frozen.
 *   - `foundingFp`, `newFp`, `revokedFp` are key fingerprints and `reverseSig` is an
 *     Ed25519 signature over a fixed message. The signature is the sharpest case in
 *     the catalog: it is verified byte for byte, so a door that could alter one byte
 *     of it would turn a valid enrollment into an unprovable one.
 */
export const PAYLOAD_TEXT: {
  readonly [K in EventKind]: { readonly [P in PayloadPath<K>]: FieldNature };
} = {
  'run.started': { agent: 'prose', goal: 'prose' },
  'run.ended': { outcome: 'prose' },
  'task.created': { title: 'prose' },
  'task.transitioned': {
    from: 'identifier',
    to: 'identifier',
    action: 'identifier',
    'fields.reason': 'prose',
    'fields.note': 'prose',
    'fields.feedback': 'prose',
    'fields.pr_url': 'prose',
    'fields.links': 'prose',
  },
  'decision.recorded': {
    title: 'prose',
    rationale: 'prose',
    adr: 'identifier',
    alternatives: 'prose',
  },
  'decision.transitioned': {
    from: 'identifier',
    to: 'identifier',
    action: 'identifier',
    by: 'identifier',
    'fields.reason': 'prose',
    'fields.note': 'prose',
    'fields.feedback': 'prose',
    'fields.pr_url': 'prose',
    'fields.links': 'prose',
  },
  'identity.founded': { foundingFp: 'identifier' },
  'key.enrolled': { newFp: 'identifier', reverseSig: 'identifier' },
  'key.revoked': { revokedFp: 'identifier', reason: 'prose' },
  'memory.captured': { content: 'prose' },
  'observation.recorded': { about: 'prose', topic: 'prose', text: 'prose' },
  'handoff.recorded': { fromAgent: 'prose', toAgent: 'prose' },
  'knowledge.linked': { target: 'prose', rel: 'prose' },
  'skill.created': { name: 'prose', body: 'prose' },
  'skill.transitioned': {
    from: 'identifier',
    to: 'identifier',
    action: 'identifier',
    'fields.reason': 'prose',
    'fields.note': 'prose',
    'fields.feedback': 'prose',
    'fields.pr_url': 'prose',
    'fields.links': 'prose',
  },
  // No payload field at all: a consultation is entirely envelope. The empty table
  // is the classification of a kind that declares nothing to classify, and it is
  // not vacuous cover — the kind's SUBJECT is prose, and that is where its one
  // caller-supplied string is answered for.
  'skill.consulted': {},
  // The `tail` is a caller's string and it is still an IDENTIFIER, by the rule this
  // file states rather than by how it is spelled: the write door refuses the waiver
  // unless the record holds that exact tail, so what gets stored came out of the
  // record — the same case as a transition's subject. `throughHash` is read off the
  // disk by the operation and is compared byte for byte when the note is later held
  // against a copy of the tail, so a scrubber there would destroy the evidence. Only
  // `reason` is a caller's prose. (`eventCount` is a number and is no field of this
  // table: there is nothing textual to screen.)
  'tail.pruned': { tail: 'identifier', throughHash: 'identifier', reason: 'prose' },
};

/**
 * The nature of one field of one kind, addressed the way an event is walked:
 * `payload.<path>` for anything under the payload, the bare name for an envelope
 * field. Undefined means the catalog grew a text field nobody classified — which is
 * the answer the guard turns into a failure rather than a default.
 *
 * ONE function, asked by both halves of the proof: the half that poisons a field
 * consults it to know which fields to poison, and the half that reads the chain back
 * consults it to know what each value it found was supposed to be. Two readings of
 * one table cannot come to disagree about a field the way two tables would.
 */
export function fieldNature(kind: EventKind, path: string): FieldNature | undefined {
  const payload = path.startsWith('payload.') ? path.slice('payload.'.length) : undefined;
  if (payload !== undefined) {
    return (PAYLOAD_TEXT[kind] as Readonly<Record<string, FieldNature>>)[payload];
  }
  if (path === 'subject') return SUBJECT_TEXT[kind];
  return (ENVELOPE_TEXT as Readonly<Record<string, FieldNature>>)[path];
}

/**
 * Every field of one kind that carries text a caller wrote, as the paths an event
 * is walked by — the payload's own leaves plus the subject when the kind's subject
 * is a caller's reference.
 *
 * The two shared envelope fields (`which`, `run`) are NOT here, and their absence is
 * the point: they are the same two on every kind, so a guard that drove them
 * per-kind would prove the same thing on every kind there is and still say nothing about a
 * kind that omits them legitimately. They are driven on their own axis, across the
 * whole surface at once, which is the shape that caught `which` in the first place.
 */
export function proseFieldsOf(kind: EventKind): readonly string[] {
  const paths: string[] = [];
  if (SUBJECT_TEXT[kind] === 'prose') paths.push('subject');
  for (const [field, nature] of Object.entries(PAYLOAD_TEXT[kind])) {
    if (nature === 'prose') paths.push(`payload.${field}`);
  }
  return paths;
}
