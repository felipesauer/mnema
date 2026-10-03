/**
 * Whether a piece of text that carries the WHY of a fact says anything — the one rule, asked by
 * the reader of decision files and by every door a reason is written through.
 *
 * THE READER ASKED IT FIRST. Pointed at this project's own decision documents, the reader of
 * decision files took the markdown rule `---` under a header block for a document's rationale,
 * 48 times; its answer was {@link statesSomething}, one letter or one digit in any script. The
 * write door kept asking an older question — is the string empty? — so `mnema decision record
 * "Use UTC" "***"` was recorded as a decision's why, permanently, while the reader refused the
 * same three characters from a file. Two doors, two readings of one rule. The function moved here
 * so both ask the same one: `adr/read.ts` imports it, and so does the write side through
 * {@link reasonRefusal}.
 *
 * AND A MARKER IS NOT A REASON EITHER. The product prints recipes with markers in them —
 * `mnema key revoke <fingerprint> --reason "<why>"`, `--note "<why>"` — and a recipe pasted
 * without filling the marker in used to record `<why>` as the reason, for good. `<why>` has
 * letters, so {@link statesSomething} cannot see it. {@link isMarker} is the SHAPE the product's
 * markers take (`<` a lowercase word `>`), not a list of today's: the guard over every command
 * the product hands over (`the-command-handed-over-runs-as-handed.test.ts`) fills markers by
 * this same pattern, so a marker a new page prints is one the write door already refuses.
 *
 * AND A MARKER IS NO TITLE. This module used to ask the marker question of the why alone, and
 * said so: `<title>` as a title was accepted. It was the same paste one field over —
 * `mnema decision record "<title>" "<rationale>"` recorded a decision named `<title>`, and a
 * decision file whose heading was `# <title>` was imported as one. {@link TITLES} is where each
 * kind keeps the one short line that names a record, and {@link titleRefusal} asks
 * {@link isMarker} of it, the same function.
 *
 * AND A TITLE OF PUNCTUATION IS NO TITLE EITHER. This said *"only the marker: a title is not asked
 * whether it states something here, so `***` as a title is still recorded (the reader of decision
 * files refuses that one on its own, `NO_TITLE`)"* — and that was the same two-doors defect the
 * paragraph above tells of for the why, one field over: the reader refused `# ***` as `NO_TITLE`
 * while `mnema decision record '***' '…'` recorded a decision named `***`, permanently, and every
 * citation of it (`ADR-3 — ***`) read as nothing. {@link titleRefusal} asks
 * {@link statesSomething} of a title now, the function the reader asks, so a title with no letter
 * and no digit is refused at the door the reader refuses it at.
 *
 * AND A MARKER IS NO REFERENCE. The fields a reading looks up by exact string — a link's subject,
 * target and relation, the entity an observation is about, the agents of a handoff, a run's
 * agent — are not a line a person writes (that is {@link TITLES}) and not a why, and a recipe
 * pastes a marker into them all the same: `mnema link <id> <path> --rel governs` recorded an
 * edge from the entity `<id>`, and `--rel '<rel>'` recorded a relation nothing can ever ask for.
 * {@link REFERENCES} is where each kind keeps them and {@link referenceRefusal} asks
 * {@link isMarker} of each, again the same function. Only the marker is asked: a reference is a
 * string a caller owns (`src/**`, a path with a bracket in it), and what it holds is not a
 * judgment this door makes.
 *
 * WHAT IT DOES NOT JUDGE is whether the words are a GOOD reason. `n/a` states something. A
 * person rules on prose; this rules only that there is some, and that it is not the blank a
 * recipe left for it.
 */

import type { CatalogEvent, EventKind, TransitionFields } from '@mnema/chain';
import { oneLine } from './one-line.js';

/**
 * True when the text holds one letter or one digit, in any script. Markdown's furniture — rules,
 * emphasis, pipes, bullets — has neither by construction, so it falls out without being listed.
 */
export function statesSomething(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * The shape of a marker the product prints for a value a person fills in: `<why>`, `<id>`,
 * `<the line>`, `<path...>`. Exported so the guard over the commands the product hands over fills
 * markers by the same pattern this door refuses them by.
 */
export const MARKER = /<[a-z][a-z0-9 .-]*>/;

const WHOLE_MARKER = new RegExp(`^${MARKER.source}$`);

/** True when the whole value, trimmed, is a marker and nothing else. */
export function isMarker(text: string): boolean {
  return WHOLE_MARKER.test(text.trim());
}

/**
 * The refusal a reason earns, or undefined when it says something. `field` is the name a person
 * gave it (`rationale`, `reason`, `note`), so the sentence names the value they typed.
 */
export function reasonRefusal(
  field: string,
  value: unknown,
): { readonly message: string } | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (isMarker(value)) {
    return {
      message:
        `the ${field} "${oneLine(value.trim())}" is the marker a recipe prints where the words go, ` +
        'not the words: write the why in its place',
    };
  }
  if (!statesSomething(value)) {
    return {
      message:
        `the ${field} "${oneLine(value)}" has no letter and no digit in it, so it says nothing: ` +
        'write the why in words',
    };
  }
  return undefined;
}

/**
 * The refusal a title earns, or undefined when it names something. `field` is the name the kind
 * gives it (`title`, `name`, `topic`), so the sentence names the value they typed and what goes
 * in its place. A marker is refused as a marker; a text with no letter and no digit in it
 * (`***`, `---`) is refused as naming nothing — the question the reader of decision files asks of
 * a heading, by the same function.
 */
export function titleRefusal(
  field: string,
  value: unknown,
): { readonly message: string } | undefined {
  if (typeof value !== 'string' || value.trim().length < 1) return undefined;
  if (isMarker(value)) {
    return {
      message:
        `the ${field} "${oneLine(value.trim())}" is the marker a recipe prints where the words go, ` +
        `not the words: write the ${field} in its place`,
    };
  }
  if (!statesSomething(value)) {
    return {
      message:
        `the ${field} "${oneLine(value)}" has no letter and no digit in it, so it names nothing: ` +
        `write the ${field} in words`,
    };
  }
  return undefined;
}

/** The proof fields of a transition that carry a why (a pull request url and links do not). */
export const REASON_PROOF_FIELDS = [
  'reason',
  'note',
  'feedback',
] as const satisfies readonly (keyof TransitionFields)[];

type PayloadOf<K extends EventKind> = Extract<CatalogEvent, { kind: K }>['payload'];

/** A payload field of kind `K` whose value is text. */
type TextField<K extends EventKind> = {
  [F in keyof PayloadOf<K>]-?: NonNullable<PayloadOf<K>[F]> extends string ? F : never;
}[keyof PayloadOf<K>];

/** What of an event of kind `K` can carry a why: its own text fields, or its proof. */
type ReasonSite<K extends EventKind> =
  | TextField<K>
  | (PayloadOf<K> extends { readonly fields?: TransitionFields } ? 'fields' : never);

/**
 * Which part of each kind carries the WHY of the fact — the fields {@link reasonRefusal} is asked
 * of on the way in. `fields` stands for a transition's proof, of which {@link REASON_PROOF_FIELDS}
 * are the ones that are prose.
 *
 * TOTAL BY TYPE: a kind added to the catalog does not compile until it has a row here, even an
 * empty one, so nobody adds a reason field without being asked whether it says something. An
 * empty row is a kind whose text is the fact itself (a title, a memory, an observation) or an
 * identifier, and not the why of one.
 */
export const REASONS: { readonly [K in EventKind]: readonly ReasonSite<K>[] } = {
  'run.started': [],
  'run.ended': [],
  'task.created': [],
  'task.transitioned': ['fields'],
  'decision.recorded': ['rationale', 'alternatives'],
  'decision.transitioned': ['fields'],
  'identity.founded': [],
  'key.enrolled': [],
  'key.revoked': ['reason'],
  'memory.captured': [],
  'observation.recorded': [],
  'handoff.recorded': [],
  'knowledge.linked': [],
  'skill.created': [],
  'skill.transitioned': ['fields'],
  'skill.consulted': [],
  'tail.pruned': ['reason'],
  'channel.switched': ['reason'],
  'channel.served': [],
  'channel.asked': [],
  'channel.refused': [],
  // The whole standing of a retraction is its reason: one that says nothing is refused.
  'note.retracted': ['reason'],
  // A check's program is not a why, and a failure's words are the runner's, not a person's.
  'check.declared': [],
  'checker.enrolled': [],
  'check.passed': [],
  'check.failed': [],
};

/** The refusal the first reason of `event` that says nothing earns, or undefined. */
export function unstatedReason(event: CatalogEvent): string | undefined {
  const payload = event.payload as Readonly<Record<string, unknown>>;
  for (const site of REASONS[event.kind] as readonly string[]) {
    if (site === 'fields') {
      const refused = unstatedProof(payload.fields as TransitionFields | undefined);
      if (refused !== undefined) return refused;
      continue;
    }
    const refused = reasonRefusal(site, payload[site]);
    if (refused !== undefined) return refused.message;
  }
  return undefined;
}

/**
 * Which field of each kind is its TITLE — the one short line that names a record — the field
 * {@link titleRefusal} is asked of on the way in.
 *
 * The cut is the one the search index already draws (`projections/search-store.ts`): its `title`
 * column takes a task's and a decision's title, a skill's name and an observation's topic, and
 * nothing else. The other names of the catalog (a run's agent, an observation's `about`, a link's
 * target and relation, a handoff's two agents) are references and labels a reading looks up by
 * exact string, not a line a person writes to name what they record.
 *
 * TOTAL BY TYPE, like {@link REASONS}: a kind added to the catalog does not compile until it has a
 * row here, even an empty one.
 */
export const TITLES: { readonly [K in EventKind]: readonly TextField<K>[] } = {
  'run.started': [],
  'run.ended': [],
  'task.created': ['title'],
  'task.transitioned': [],
  'decision.recorded': ['title'],
  'decision.transitioned': [],
  'identity.founded': [],
  'key.enrolled': [],
  'key.revoked': [],
  'memory.captured': [],
  'observation.recorded': ['topic'],
  'handoff.recorded': [],
  'knowledge.linked': [],
  'skill.created': ['name'],
  'skill.transitioned': [],
  'skill.consulted': [],
  'tail.pruned': [],
  'channel.switched': [],
  'channel.served': [],
  'channel.asked': [],
  'channel.refused': [],
  'note.retracted': [],
  'check.declared': [],
  'checker.enrolled': [],
  'check.passed': [],
  'check.failed': [],
};

/** The refusal the title of `event` earns when it is a marker, or undefined. */
export function unfilledTitle(event: CatalogEvent): string | undefined {
  const payload = event.payload as Readonly<Record<string, unknown>>;
  for (const site of TITLES[event.kind] as readonly string[]) {
    const refused = titleRefusal(site, payload[site]);
    if (refused !== undefined) return refused.message;
  }
  return undefined;
}

/** The kinds whose envelope `subject` is a caller's reference, nothing proved against the record. */
type ReferenceSubject<K extends EventKind> = K extends
  | 'handoff.recorded'
  | 'knowledge.linked'
  | 'skill.consulted'
  | 'channel.switched'
  | 'channel.served'
  | 'channel.asked'
  | 'channel.refused'
  ? 'subject'
  : never;

/** One site that holds a reference of kind `K`: a text field of its payload, or its subject. */
type ReferenceSite<K extends EventKind> = TextField<K> | ReferenceSubject<K>;

/**
 * Which part of each kind is a REFERENCE — a string a caller hands in that a later reading
 * looks up by exact match — the fields {@link referenceRefusal} is asked of on the way in.
 *
 * The cut is `content/fields.ts`'s: the payload fields it classifies as names and that are not a
 * title ({@link TITLES}), plus the subject of the four kinds it calls "the caller's REFERENCE,
 * unproved". A subject minted here or proved against the record cannot hold a marker, so it is
 * not listed; a channel's name is a reference the surface checks and this package cannot.
 *
 * TOTAL BY TYPE, like {@link REASONS} and {@link TITLES}: a kind added to the catalog does not
 * compile until it has a row here, even an empty one.
 */
export const REFERENCES: { readonly [K in EventKind]: readonly ReferenceSite<K>[] } = {
  'run.started': ['agent'],
  'run.ended': [],
  'task.created': [],
  'task.transitioned': [],
  'decision.recorded': [],
  'decision.transitioned': [],
  'identity.founded': [],
  'key.enrolled': [],
  'key.revoked': [],
  'memory.captured': [],
  'observation.recorded': ['about'],
  'handoff.recorded': ['subject', 'fromAgent', 'toAgent'],
  'knowledge.linked': ['subject', 'target', 'rel'],
  'skill.created': [],
  'skill.transitioned': [],
  'skill.consulted': ['subject'],
  'tail.pruned': [],
  'channel.switched': ['subject'],
  'channel.served': ['subject'],
  'channel.asked': ['subject'],
  'channel.refused': ['subject'],
  // The note a retraction names is proved against the record before it is written.
  'note.retracted': [],
  'check.declared': [],
  'checker.enrolled': [],
  'check.passed': [],
  'check.failed': [],
};

/**
 * The refusal a reference earns when it is a marker, or undefined. `field` is what the surface
 * calls the value (`target`, `rel`, `about`), so the sentence names what they typed.
 */
export function referenceRefusal(
  field: string,
  value: unknown,
): { readonly message: string } | undefined {
  if (typeof value !== 'string' || !isMarker(value)) return undefined;
  return {
    message:
      `the ${field} "${oneLine(value.trim())}" is the marker a recipe prints where the value goes, ` +
      `not the value: write the ${field} in its place`,
  };
}

/** The refusal the first reference of `event` that is a marker earns, or undefined. */
export function unfilledReference(event: CatalogEvent): string | undefined {
  const payload = event.payload as Readonly<Record<string, unknown>>;
  const envelope = event as unknown as Readonly<Record<string, unknown>>;
  for (const site of REFERENCES[event.kind] as readonly string[]) {
    const refused = referenceRefusal(site, site === 'subject' ? envelope.subject : payload[site]);
    if (refused !== undefined) return refused.message;
  }
  return undefined;
}

/**
 * The refusal the first prose field of a transition's proof that says nothing earns — the
 * question the gates put to a proof before they authorize it, so a dry run and the write it
 * previews give one verdict.
 */
export function unstatedProof(fields: TransitionFields | undefined): string | undefined {
  if (fields === undefined || fields === null || typeof fields !== 'object') return undefined;
  for (const field of REASON_PROOF_FIELDS) {
    const refused = reasonRefusal(field, fields[field]);
    if (refused !== undefined) return refused.message;
  }
  return undefined;
}
