/**
 * What every text field of the catalog IS — a name the record is addressed by, a body
 * the record states, or an identifier the record derived — and therefore which of them
 * the content door owes a pass over, and what it owes each.
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
 * THE FIRST RULE, IN ONE SENTENCE. A field is the CALLER'S when the value the chain
 * stores is one the caller supplied and this package never proved anything about; it
 * is an IDENTIFIER when the value is derived here (a mint, a key, the clock, a gate's
 * verdict, a closed vocabulary) or was looked up in the record before being stored.
 *
 * THE SECOND RULE CUTS THE CALLER'S HALF IN TWO, and it decides what the door DOES
 * rather than whether the door runs. A field is a NAME when a reading addresses the
 * record by it, and a BODY when the field is what the record says. The difference is
 * not a matter of degree:
 *   - A body with the credential replaced IS STILL THE FACT. The decision still says
 *     what was decided, the memory still says what to remember, and the credential
 *     did not enter. That is redaction, and it works.
 *   - A name with the credential replaced IS NOT THE SAME ENTITY. `<SECRET:openai-key>`
 *     is not the skill the person created; it is something else wearing that skill's
 *     id. On an append-only log the name the person chose is then unrecoverable, and
 *     every reading that keys on it — `WHERE rel = ?`, the search index's title
 *     column, a lookup by `about` — now matches nothing or matches the wrong thing.
 *     That is not redaction; it is corruption of identity.
 * So a name carrying a credential is REFUSED at the door and a body is redacted, and
 * which of the two a field is answered HERE, once, for the same reason the first rule
 * is: a second opinion about it would be a second place to be wrong.
 *
 * THE CUT IS NOT INVENTED HERE — the product had already drawn it, in another hand
 * and for another purpose. `search-store.ts` indexes the caller's text in two
 * columns "by ROLE rather than by field name": `title` takes "the one short line that
 * NAMES a record (an observation's topic, a skill's name)" and `body` takes the
 * prose. Every field this file calls a name is one that reader puts in its title
 * column or keys a `WHERE` on; every field it calls a body is one that reader puts in
 * its body column. Two modules that never call each other agreeing on the line is the
 * evidence that the line is in the domain rather than in this table.
 *
 * The second half of that first sentence is what puts the REFERENCE fields on the
 * caller's side, which surprises until it is read twice. An observation's `about`, a link's
 * `target`, a handoff's task, a consultation's skill: each is an id BY CONTRACT and
 * none of them is validated — a dangling cross-tree reference is honest here — so in
 * practice each holds whatever a caller sent, and each has gone through the door for
 * as long as the door has existed. A transition's subject is the opposite case in
 * the same shape: it is a caller's string too, but the operation refuses it unless
 * the projection already holds it, so what gets stored came out of the record.
 * "Validated against the record" is the line, not "named like an id".
 *
 * WHAT THE THREE NATURES OBLIGE, and they are not three flavours of one thing:
 *   - NAME and BODY must both reach `screenContent` before they reach the chain. A
 *     caller's field that no operation screens is a credential recorded verbatim.
 *   - A NAME that carries one is REFUSED, and nothing is appended. The refusal names
 *     the class and the field and never the value.
 *   - A BODY that carries one is RECORDED REDACTED, and the caller is told what was
 *     replaced so it can rotate the credential.
 *   - IDENTIFIER must reach the chain UNTOUCHED. A fingerprint is compared, a
 *     reverse-signature is verified byte for byte, an id is a lookup key: a
 *     placeholder in any of them breaks the thing the record exists to prove. So
 *     the guard asserts the door did NOT run on these, which is the half that keeps
 *     it from turning into the damage it is defending against.
 * All four obligations are driven per field by `every-field.test.ts`, from these
 * tables: a name is poisoned and the write must be refused with nothing on the
 * chain, a body is poisoned and the write must land with the marker and no
 * credential, an identifier must come back byte for byte.
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
 * What a field's value is, and therefore what the door owes it: a name the record is
 * addressed by (refuse a credential in it), a body the record states (redact one), or
 * a value the record derived or proved (leave it alone).
 *
 * The first two used to be one nature, `prose`, and the premise that made them one
 * was that screening is screening. A name falsified it: replacing a credential in a
 * body leaves the fact intact, and replacing one in a name leaves a different entity
 * under the same id, permanently, on a log that cannot be edited.
 */
export type FieldNature = 'name' | 'body' | 'identifier';

/**
 * The two natures the door acts on. An identifier never reaches it, so a key the door
 * is handed is one of these — which is what makes {@link ScreenedKey} a closed union
 * rather than a string.
 */
type ScreenedNature = Exclude<FieldNature, 'identifier'>;

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
 * `which` is the caller's and has been screened since the day it was found unscreened.
 * `run` is the caller's for exactly the same reasons and is the one this classification FOUND: it
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
/**
 * BOTH CALLER-SUPPLIED FIELDS HERE ARE NAMES, and neither is a close call. `which` is
 * WHO — every reading that asks what an agent did keys on it, and an agent recorded
 * as `<SECRET:slack-token>` did the work of nobody. `run` is WHERE — it is the
 * session a fact is pinned to, so a replaced one pins every fact of that session to a
 * run no reader can find. Both are stamped on EVERY event of a session, so getting
 * this wrong is not one corrupt name but as many as the session has facts.
 */
export const ENVELOPE_TEXT = {
  kind: 'identifier',
  at: 'identifier',
  who: 'identifier',
  signerFp: 'identifier',
  which: 'name',
  run: 'name',
} as const satisfies {
  readonly [P in Exclude<TextPath<Envelope>, 'subject'>]: FieldNature;
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
 *     `skill.consulted`, `channel.switched`) — the subject IS a string a caller sent and
 *     nothing here confirms, so it goes through the door, which is what those four
 *     operations already do.
 *
 * EVERY SUBJECT THAT REACHES THE DOOR IS A NAME, and that is a property of what a
 * subject IS rather than a coincidence of these six kinds: the subject is the thing
 * the fact is ABOUT, so every reading of it is a lookup by exact string. A replaced
 * subject does not make the fact vaguer — it makes the fact be about something else,
 * or about nothing. That is why the door can be handed the key `subject` and answer
 * without being told the kind: no subject is a body, and the ones that are
 * identifiers never reach the door at all.
 *
 * The last of those four is the one that reads wrong at first, and it is this file's own
 * rule applied honestly rather than an oversight. A channel name looks like a closed
 * vocabulary — there are two of them, and the verb refuses a third — but the vocabulary
 * lives in the SURFACE that pushes those channels, three packages downstream, and nothing
 * this package can reach knows the names. So what is stored is whatever a caller sent,
 * and calling it an identifier because a command-line verb happens to check it is exactly
 * the reasoning this file rejects for `run` below: an invariant enforced only where
 * somebody remembered it is a habit, not a property. Screening it is also safe in the
 * direction that matters — the reading is a lookup by exact name, so a scrubbed channel
 * matches nothing and the switch simply does not apply, which is the failure that leaves
 * the product SPEAKING rather than the one that silences it.
 */
export const SUBJECT_TEXT = {
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
  'handoff.recorded': 'name',
  'knowledge.linked': 'name',
  'skill.created': 'identifier',
  'skill.transitioned': 'identifier',
  'skill.consulted': 'name',
  'channel.switched': 'name',
  // The same string, from the same place, answered the same way: the two facts a channel
  // produces name it exactly as the fact somebody makes ABOUT it does, and this package
  // still has no idea which channels exist.
  'channel.served': 'name',
  'channel.asked': 'name',
  // DERIVED from the record: the anchor a waiver names is read off the pruned
  // tail's own last event, never handed in. No caller can put anything in it.
  'tail.pruned': 'identifier',
} as const satisfies { readonly [K in EventKind]: FieldNature };

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
export const PAYLOAD_TEXT = {
  'run.started': { agent: 'name', goal: 'body' },
  'run.ended': { outcome: 'body' },
  'task.created': { title: 'name' },
  'task.transitioned': {
    from: 'identifier',
    to: 'identifier',
    action: 'identifier',
    'fields.reason': 'body',
    'fields.note': 'body',
    'fields.feedback': 'body',
    'fields.pr_url': 'body',
    'fields.links': 'body',
  },
  'decision.recorded': {
    title: 'name',
    rationale: 'body',
    adr: 'identifier',
    alternatives: 'body',
  },
  'decision.transitioned': {
    from: 'identifier',
    to: 'identifier',
    action: 'identifier',
    by: 'identifier',
    'fields.reason': 'body',
    'fields.note': 'body',
    'fields.feedback': 'body',
    'fields.pr_url': 'body',
    'fields.links': 'body',
  },
  'identity.founded': { foundingFp: 'identifier' },
  'key.enrolled': { newFp: 'identifier', reverseSig: 'identifier' },
  'key.revoked': { revokedFp: 'identifier', reason: 'body' },
  'memory.captured': { content: 'body' },
  // `about` and `topic` are NAMES and `text` is the body, which is the same cut the
  // search index draws over this very kind: it puts the topic in its title column and
  // the text in its body column. `about` is the entity the note is about, read back by
  // exact id; a replaced one leaves a note attached to nothing.
  'observation.recorded': { about: 'name', topic: 'name', text: 'body' },
  'handoff.recorded': { fromAgent: 'name', toAgent: 'name' },
  // Both are names, and `rel` is the one that reads wrong until the reader is checked.
  // It is an OPEN label rather than a closed vocabulary, which is why it is the
  // caller's — but `knowledge-store.ts` answers `SELECT * FROM links WHERE rel = ?`,
  // so it is addressed by exact string like any id. A replaced `rel` is an edge whose
  // relation nothing can ever ask for again.
  'knowledge.linked': { target: 'name', rel: 'name' },
  'skill.created': { name: 'name', body: 'body' },
  'skill.transitioned': {
    from: 'identifier',
    to: 'identifier',
    action: 'identifier',
    'fields.reason': 'body',
    'fields.note': 'body',
    'fields.feedback': 'body',
    'fields.pr_url': 'body',
    'fields.links': 'body',
  },
  // No payload field at all: a consultation is entirely envelope. The empty table
  // is the classification of a kind that declares nothing to classify, and it is
  // not vacuous cover — the kind's SUBJECT is a name, and that is where its one
  // caller-supplied string is answered for.
  'skill.consulted': {},
  // The `tail` is a caller's string and it is still an IDENTIFIER, by the rule this
  // file states rather than by how it is spelled: the write door refuses the waiver
  // unless the record holds that exact tail, so what gets stored came out of the
  // record — the same case as a transition's subject. `throughHash` is read off the
  // disk by the operation and is compared byte for byte when the note is later held
  // against a copy of the tail, so a scrubber there would destroy the evidence. Only
  // `reason` is the caller's, and it is a body. (`eventCount` is a number and is no
  // field of this table: there is nothing textual to screen.)
  'tail.pruned': { tail: 'identifier', throughHash: 'identifier', reason: 'body' },
  // Only `reason` — `on` is a boolean and is no field of this table, by the same rule
  // that keeps `eventCount` out of it: there is nothing textual to screen. The channel
  // itself is the SUBJECT, answered above.
  'channel.switched': { reason: 'body' },
  // Nothing to classify, and not vacuous cover: like a consultation, the whole fact is
  // envelope, and the one caller-supplied string it carries is its SUBJECT, answered above.
  'channel.served': {},
  // The `rule` is an IDENTIFIER by this file's own rule rather than by how it is spelled: it
  // is an id that came OUT of the record, because the only thing that produces this fact is
  // the derivation of what is in force, and a rule no tree holds never reaches it — the same
  // case as a supersede's `by`. Screening it would be the sharpest wrong answer in this
  // table: a rule id is a v7, so a scrubber would take it for entropy and destroy the one
  // field the axis requires a charge to carry, leaving a signed accusation that names
  // nothing. `path` is the host's own string, normalized and never checked, so it is the
  // caller's exactly as a link's target is.
  //
  // AND `path` IS A BODY, which is the one field of this table where the second rule was
  // a real call rather than a reading. It looks like an address, and it is one — but
  // nothing in this record is ADDRESSED by it: no projection keys on it, no reader looks a
  // charge up by the file it happened in (swept for, and the count is zero). It is the
  // circumstance a rule was charged in, not the identity of the thing charged, and the
  // fact — this rule was in force where this edit was about to happen — survives its
  // redaction. Refusing it would make an automatic hook fail over a file NAME, which
  // trades a fact the record wants for nothing it protects.
  'channel.asked': { rule: 'identifier', path: 'body' },
} as const satisfies {
  readonly [K in EventKind]: { readonly [P in PayloadPath<K>]: FieldNature };
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
 * Every field of one kind that carries text a caller supplied, as the paths an event
 * is walked by — the payload's own leaves plus the subject when the kind's subject
 * is a caller's reference. Names and bodies alike: what this answers is which fields
 * the door OWES a pass over, and {@link fieldNature} is what says what it owes each.
 *
 * RENAMED from `proseFieldsOf` when `prose` stopped being one nature. The rename is
 * not cosmetic: the old name is now a claim this function does not make, and a caller
 * that still wanted "the fields the door redacts" would have gone on getting the
 * names too — silently, since the shape did not change.
 *
 * The two shared envelope fields (`which`, `run`) are NOT here, and their absence is
 * the point: they are the same two on every kind, so a guard that drove them
 * per-kind would prove the same thing on every kind there is and still say nothing about a
 * kind that omits them legitimately. They are driven on their own axis, across the
 * whole surface at once, which is the shape that caught `which` in the first place.
 */
export function screenedFieldsOf(kind: EventKind): readonly string[] {
  const paths: string[] = [];
  if (SUBJECT_TEXT[kind] !== 'identifier') paths.push('subject');
  for (const [field, nature] of Object.entries(PAYLOAD_TEXT[kind]) as [string, FieldNature][]) {
    if (nature !== 'identifier') paths.push(`payload.${field}`);
  }
  return paths;
}

/**
 * The last segment of a dotted path — the spelling a caller hands the door.
 *
 * A transition's proof is passed in as `{ reason, note }` and classified at
 * `fields.reason`, so the door and the table meet at the leaf. It is one function for
 * the type below and the derivation beneath it, which is what keeps the two from
 * disagreeing about where a path is cut.
 */
type LeafKey<P extends string> = P extends `${string}.${infer Rest}` ? LeafKey<Rest> : P;

/**
 * The same cut, at runtime — the ADDRESS where this table and the door meet.
 *
 * Exported because the proof of their agreement has to ask it rather than re-implement
 * it: a test that cut `fields.reason` down to `reason` with its own expression would be
 * a second reading of exactly the rule it exists to check, and the two could come to
 * disagree about a path with two dots in it while the case stayed green.
 */
export function leafKey(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? path : path.slice(dot + 1);
}

/**
 * The keys of one classification table whose nature the door acts on, at the
 * spelling a caller hands in. An identifier's key is dropped: the door never
 * receives one, so admitting its key would let a caller hand the door a field the
 * record proves things with.
 */
type ScreenedKeysOf<T> = {
  [P in keyof T]: T[P] extends ScreenedNature ? LeafKey<P & string> : never;
}[keyof T];

/**
 * Every field key the door may be handed — the closed union the catalog's own
 * declarations produce.
 *
 * THIS IS WHERE THE DOOR'S TOTALITY LIVES, and it lives in `src` on purpose: a type
 * error declared in a test file leaves both the build and the suite green (`tsc -b`
 * excludes tests and vitest erases types without checking), so a mapped type there
 * would be a guard that cannot fail. Here it is the compiler: a field added to any
 * payload joins this union the moment it is classified, and a call that hands the
 * door a key no table declares does not compile.
 *
 * It is derived from the tables' VALUES, not just their keys, which is why they are
 * written `as const satisfies` — the `satisfies` keeps the totality obligation the
 * mapped types state, and the `as const` keeps each field's answer in the type so
 * the identifiers can be filtered out of this union.
 */
export type ScreenedKey =
  | ScreenedKeysOf<typeof ENVELOPE_TEXT>
  // `subject` is admitted when any kind's subject is one of the door's natures. It is
  // written as a condition rather than as the literal so that a catalog in which every
  // subject became an identifier would stop admitting the key, instead of leaving a
  // door that accepts a field nothing classifies.
  | ((typeof SUBJECT_TEXT)[EventKind] extends 'identifier' ? never : 'subject')
  | { [K in EventKind]: ScreenedKeysOf<(typeof PAYLOAD_TEXT)[K]> }[EventKind];

/**
 * What the door owes each key it can be handed — the by-KEY reading of the by-KIND
 * tables above.
 *
 * DERIVED, NEVER DECLARED, and that is the whole of the anti-divergence. The door is
 * handed keys (`{ title, rationale }`) and the tables are keyed by kind and path, so
 * something has to bridge them; a second table listing name-fields by key would be a
 * second place where fields are enumerated, which is exactly the shape that produced
 * the defect this file was written for. So the bridge is a fold over the tables,
 * computed once at load, and a key two kinds classify DIFFERENTLY is not resolved by
 * precedence — it THROWS, here, before anything can be written under the wrong answer.
 * A conflict is unrepresentable in the shipped product rather than merely untested.
 *
 * Identifiers are folded out rather than recorded, for the reason `ScreenedKey` drops
 * them: they never reach the door. That is also what keeps `subject` free of a
 * conflict it would otherwise always have — it is an identifier on fourteen kinds and
 * a name on six, and only the six are a question for the door.
 */
const NATURE_BY_KEY: ReadonlyMap<string, ScreenedNature> = ((): Map<string, ScreenedNature> => {
  const byKey = new Map<string, ScreenedNature>();
  const declare = (key: string, nature: FieldNature, where: string): void => {
    if (nature === 'identifier') return;
    const already = byKey.get(key);
    if (already !== undefined && already !== nature) {
      throw new Error(
        `the field key "${key}" is classified both ${already} and ${nature} (at ${where}); ` +
          'the content door is handed keys rather than paths, so one key cannot be both',
      );
    }
    byKey.set(key, nature);
  };
  for (const [key, nature] of Object.entries(ENVELOPE_TEXT) as [string, FieldNature][]) {
    declare(key, nature, `the envelope's ${key}`);
  }
  for (const [kind, nature] of Object.entries(SUBJECT_TEXT) as [string, FieldNature][]) {
    declare('subject', nature, `${kind}'s subject`);
  }
  for (const [kind, table] of Object.entries(PAYLOAD_TEXT)) {
    for (const [path, nature] of Object.entries(table) as [string, FieldNature][]) {
      declare(leafKey(path), nature, `${kind}.${path}`);
    }
  }
  return byKey;
})();

/**
 * Whether the door must REFUSE a credential in this field rather than redact one.
 *
 * The door's one question, and the only reading of {@link NATURE_BY_KEY} there is.
 *
 * A key the map does not hold cannot arrive from anywhere that compiles — that is what
 * {@link ScreenedKey} is for — and is answered `true` rather than `false` if it ever
 * does. The fallback is the side that refuses: an unclassified field of unknown nature
 * is one nobody has decided about, and declining to write it is recoverable where
 * writing a corrupted name into an append-only log is not.
 */
export function screensAsAName(key: string): boolean {
  return (NATURE_BY_KEY.get(key) ?? 'name') === 'name';
}
