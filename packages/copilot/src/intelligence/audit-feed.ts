/**
 * The record as a feed of AUDIT FACTS another system can read — one OCSF event per
 * line, and the envelope only.
 *
 * ## What decides this module, and it is not the format
 *
 * Every other reading in this product answers ONTO A TERMINAL, on the machine that
 * holds the record. This one answers into a file somebody forwards: a SIEM ingests it,
 * indexes it, keeps it, and lets a stranger search it. That is the first time content
 * of the record leaves the machine at all, and it is the whole reason this module reads
 * an {@link AuditEnvelope} and not an event.
 *
 * THE PRODUCT ALREADY SAID WHERE THE LINE IS. `mnema exposure` reports which records
 * hold something shaped like a credential and prints *"never the value — not truncated,
 * not partly masked, and not in `--json`"*, because a command that printed one would
 * turn the remedy into a second disclosure. The content door (`core/src/content/screen.ts`)
 * screens free text on the way IN, and it has only existed since a point in this record's
 * life: everything written before it went in with no defense at all, which is the past
 * `exposure` exists FOR. A feed that carried bodies would push exactly what `exposure`
 * refuses — off the machine, into an index, permanently, including the part of the record
 * that never passed a screen.
 *
 * So the feed carries the ENVELOPE: when, which operation, who authorized it, which agent
 * executed it, in which session, over which entity, attested by which key. That is what an
 * audit trail is, and a SIEM asks for nothing else. The body of a memory, the text of a
 * decision, the prose of an observation — none of it is a fact of authorship, and all of it
 * is where a credential lives.
 *
 * THE GUARANTEE IS STRUCTURAL, NOT A HABIT. {@link AuditEnvelope} is the envelope's
 * fields and nothing else, so a payload is not something this module declines to read — it
 * is something it cannot NAME. Widening that parameter to the cataloged event is the one
 * edit that could leak a body, and it is a visible edit to a signature rather than a line
 * lost in a mapping. TWO nets sit under it, over the bytes: `audit-feed.test.ts` next door
 * maps an event of EVERY kind whose payload is nothing but a marker and asserts no line
 * holds it (and that the fixtures really did), and `code/tests/the-feed-leaves-the-bodies-behind.test.ts`
 * does the same over a record written by the real write verbs and read back through the
 * real command line. The first is total over the catalog; the second is about the product.
 *
 * ## Why OCSF Entity Management, and what was checked
 *
 * OCSF is the vendor-neutral schema behind Amazon Security Lake, Splunk, CrowdStrike,
 * Cisco and Palo Alto, and it has been a Linux Foundation project since November 2024;
 * `metadata.version` below names the schema release this mapping was written against, read
 * from `schema.ocsf.io`. CEF and plain syslog carry no typed identity at all, which is the
 * half of an mnema event that matters most.
 *
 * Entity Management (`class_uid` 3004, category Identity & Access Management) is the class
 * whose subject is *a managed entity somebody acted on*, which is what every kind in this
 * catalog is. The mapping is not decoration: `key.enrolled` is OCSF's own word `Enroll`,
 * `key.revoked` is `Unenroll`, and a workflow move is `Update`. ONE kind of twenty has no
 * honest activity and takes `99 Other` — see {@link AUDIT_BY_KIND}.
 *
 * ## Three things it does NOT do
 *
 * IT IS NOT THE PROOF, and the temptation had a name. OCSF has a `record_integrity`
 * profile that attaches cryptographic attestations to an event and speaks of *"a sequence
 * of events forming a tamper-evident hash chain"* — a description of this product. It is
 * deliberately NOT applied. An attestation there is computed over a canonical serialization
 * of the OCSF EVENT; the signature this record holds covers mnema's own canonical bytes,
 * which are a different serialization of a different shape. Emitting the profile would
 * present a signature as attesting a document it never covered. So `signerFp` travels as
 * what it is — the identifier of the credential that signed the original fact — and a line
 * that a SIEM altered in transit is not detectable by the SIEM. The proof stays in the
 * chain, and `mnema verify` is still the only thing that rules on it.
 *
 * IT IS NOT A SOURCE OF TRUTH. Nothing in this product reads a feed back. Every line
 * carries what it takes to find the fact in the record it came from — the subject, the
 * original instant, the tree — so the answer to *"is this line real?"* is a question you
 * ask the record, never the index.
 *
 * IT INVENTS NO PROOF FIELD. The chain-link fields (the entry hash, the tail id) are
 * stamped by the chain writer and are not part of the envelope, so they are not here;
 * nothing was added to the event, to the reading, or to the verdict to make this feed
 * possible.
 */

import { type AuthorshipFilter, matchesAuthorship } from '@mnema/core';
import type { CatalogEvent, EventKind } from './events.js';
import type { ScopedEvents } from './exposure.js';

/**
 * What this module may read of an event: the proof envelope, and not one field more.
 *
 * THE TYPE IS THE GUARD. It is derived from the cataloged event rather than written out,
 * so a field ADDED to the envelope arrives here by itself and a field renamed does not
 * compile — but `payload` is not among the keys, so the mapping below cannot reach a body
 * even by accident. A reviewer checking "does the feed carry content?" reads this one line
 * instead of auditing every branch of a mapping.
 */
export type AuditEnvelope = Pick<
  CatalogEvent,
  'v' | 'kind' | 'at' | 'who' | 'signerFp' | 'which' | 'run' | 'subject'
>;

/** The OCSF class every line of this feed belongs to: Entity Management. */
export const OCSF_CLASS_UID = 3004;

/** Its category: Identity & Access Management. */
export const OCSF_CATEGORY_UID = 3;

/**
 * The OCSF schema release this mapping was written against.
 *
 * It is a CONSTANT and not a claim to track the newest: a consumer reads this to know
 * which revision of the class the fields were chosen from, and a version that drifted
 * ahead of the mapping would be the lie. Raising it is a deliberate edit, made after
 * re-reading the class.
 */
export const OCSF_SCHEMA_VERSION = '1.9.0';

/** OCSF `severity_id` 1 — Informational. A recorded fact is news, never an alarm. */
const SEVERITY_INFORMATIONAL = 1;

/**
 * OCSF `status_id` 1 — Success.
 *
 * Every event in the chain is a fact that HAPPENED: a refused write appends nothing, so
 * there is no failed operation in here to report. The field is constant because the
 * record cannot produce the other value, not because the other value is unhandled.
 */
const STATUS_SUCCESS = 1;

/**
 * The OCSF `activity_id` values of Entity Management that this catalog reaches, with the
 * caption the schema fixes for each.
 *
 * `activity_name` is not a free slot: the schema requires it to be the caption of the
 * `activity_id` for every value except `99`, where it must carry the source-specific
 * label instead. Pairing the number with its caption HERE is what makes that rule
 * impossible to break one branch at a time.
 */
const ACTIVITY = {
  create: { id: 1, caption: 'Create' },
  read: { id: 2, caption: 'Read' },
  update: { id: 3, caption: 'Update' },
  delete: { id: 4, caption: 'Delete' },
  enroll: { id: 6, caption: 'Enroll' },
  unenroll: { id: 7, caption: 'Unenroll' },
  activate: { id: 10, caption: 'Activate' },
  deactivate: { id: 11, caption: 'Deactivate' },
  other: { id: 99, caption: 'Other' },
} as const satisfies Record<string, { readonly id: number; readonly caption: string }>;

/** One activity of the class, as the pair the schema requires it be written as. */
type Activity = (typeof ACTIVITY)[keyof typeof ACTIVITY];

/** OCSF `managed_entity.type_id` 2 — User. */
const ENTITY_USER = 2;

/**
 * OCSF `managed_entity.type_id` 99 — Other, whose `uid` the schema then reads as the
 * source's own identifier, which is exactly what an mnema id is.
 */
const ENTITY_OTHER = 99;

/** How one kind is written as an audit fact: the operation, and what it was done to. */
interface AuditMapping {
  /** The normalized operation. */
  readonly activity: Activity;
  /** The normalized entity type — `User` where the subject really is an identity. */
  readonly entityTypeId: number;
  /** What the subject IS, in this product's own words. */
  readonly entityType: string;
}

/**
 * EVERY kind of the catalog, and the audit fact it becomes — the one table, total over
 * {@link EventKind} by construction, so a kind added tomorrow does not COMPILE until
 * somebody has decided how it is audited.
 *
 * IT IS ONE TABLE AND NOT TWO. The operation and the entity are one decision per kind,
 * taken while reading the same catalog entry; split across two tables they are two places
 * a new kind can be half-classified, and the half nobody notices is the one that ends up
 * `Unknown` in somebody's SIEM.
 *
 * IT LIVES IN `src` AND NOT IN A TEST, and that is measured rather than stylistic: a type
 * error declared inside a `.test.ts` leaves the build green AND the suite green, because
 * `tsc -b` excludes tests and vitest strips types without checking them. Totality asserted
 * from a test is vacuous by construction.
 *
 * ## The entries worth arguing with
 *
 * `channel.asked` is the ONE kind at `99 Other`, and it is not a gap in the effort. The
 * fact records that a rule of the record asked a person to look before a file was written
 * and the host stopped — an exercise of authority over somebody else's call. That is not a
 * create, a read, an update or a delete of the channel; Entity Management has no honest
 * verb for it, and forcing it into `Update` would tell a SIEM the channel was modified
 * when nothing about it changed. `99` is what the schema provides for precisely this, and
 * the source-specific label goes in `activity_name` as the schema requires.
 *
 * `channel.switched` is `Update` and NOT `Enable`/`Disable`, which is the entry a reader
 * will come here to argue with — the schema has both, and the fact really is one of them.
 * Which one is in the PAYLOAD (`on: boolean`), and reading it would end the property this
 * whole module rests on: the mapping would no longer be blind to bodies, it would be blind
 * to bodies *except where somebody judged a field harmless*, which is a review at every
 * future kind rather than a type. One bit today is a field tomorrow. The direction is in
 * the record, which is where a reader has to go for the reason anyway — and `Update` over
 * the channel is true.
 *
 * `run.started`/`run.ended` are `Activate`/`Deactivate` rather than `Create`/`Delete`. A
 * run is a session, and the schema glosses this pair as a transient change of the engine's
 * state, which is what a session is; `Delete` would say the run was destroyed, and nothing
 * in this record ever removes one.
 *
 * `tail.pruned` is `Delete`, with a caveat the product states loudly elsewhere: the fact
 * AUTHORIZES a cut and removes nothing itself — it is written while the tail is still
 * there, which is what makes the claim checkable. `Delete` is still the honest
 * normalization, because the event is the audit record OF a destructive act, and a SIEM
 * rule that watches for deletions is a rule that should fire here. The exact kind travels
 * in `metadata.event_code` on the same line for a reader who needs the difference.
 *
 * `handoff.recorded`'s subject is the TASK the handoff is about, not the handoff, so the
 * entity type says `task`. `tail.pruned`'s subject is the ANCHOR whose tail was cut, which
 * is why it is one of the four `User` rows and not a `tail`.
 */
export const AUDIT_BY_KIND: { readonly [K in EventKind]: AuditMapping } = {
  'run.started': { activity: ACTIVITY.activate, entityTypeId: ENTITY_OTHER, entityType: 'run' },
  'run.ended': { activity: ACTIVITY.deactivate, entityTypeId: ENTITY_OTHER, entityType: 'run' },
  'task.created': { activity: ACTIVITY.create, entityTypeId: ENTITY_OTHER, entityType: 'task' },
  'task.transitioned': {
    activity: ACTIVITY.update,
    entityTypeId: ENTITY_OTHER,
    entityType: 'task',
  },
  'decision.recorded': {
    activity: ACTIVITY.create,
    entityTypeId: ENTITY_OTHER,
    entityType: 'decision',
  },
  'decision.transitioned': {
    activity: ACTIVITY.update,
    entityTypeId: ENTITY_OTHER,
    entityType: 'decision',
  },
  // The subject is the anchor itself — an identity, which OCSF has a normalized type for.
  'identity.founded': {
    activity: ACTIVITY.create,
    entityTypeId: ENTITY_USER,
    entityType: 'identity',
  },
  'key.enrolled': { activity: ACTIVITY.enroll, entityTypeId: ENTITY_USER, entityType: 'identity' },
  'key.revoked': { activity: ACTIVITY.unenroll, entityTypeId: ENTITY_USER, entityType: 'identity' },
  'memory.captured': {
    activity: ACTIVITY.create,
    entityTypeId: ENTITY_OTHER,
    entityType: 'memory',
  },
  'observation.recorded': {
    activity: ACTIVITY.create,
    entityTypeId: ENTITY_OTHER,
    entityType: 'observation',
  },
  // Its subject is the TASK the handoff is about, so that is what the entity says.
  'handoff.recorded': {
    activity: ACTIVITY.create,
    entityTypeId: ENTITY_OTHER,
    entityType: 'task',
  },
  // The subject originates the link and may be an entity of any kind, so the type stays
  // the honest general word rather than naming one it might not be.
  'knowledge.linked': {
    activity: ACTIVITY.create,
    entityTypeId: ENTITY_OTHER,
    entityType: 'record',
  },
  'skill.created': { activity: ACTIVITY.create, entityTypeId: ENTITY_OTHER, entityType: 'skill' },
  'skill.transitioned': {
    activity: ACTIVITY.update,
    entityTypeId: ENTITY_OTHER,
    entityType: 'skill',
  },
  'skill.consulted': { activity: ACTIVITY.read, entityTypeId: ENTITY_OTHER, entityType: 'skill' },
  // The subject is the anchor the cut tail spoke for, not the tail.
  'tail.pruned': { activity: ACTIVITY.delete, entityTypeId: ENTITY_USER, entityType: 'identity' },
  'channel.switched': {
    activity: ACTIVITY.update,
    entityTypeId: ENTITY_OTHER,
    entityType: 'channel',
  },
  'channel.served': { activity: ACTIVITY.read, entityTypeId: ENTITY_OTHER, entityType: 'channel' },
  'channel.asked': { activity: ACTIVITY.other, entityTypeId: ENTITY_OTHER, entityType: 'channel' },
};

/** Who is reporting the feed — the producer's own identity, which the record does not hold. */
export interface AuditProducer {
  /** The product's name, as `metadata.product.name`. */
  readonly product: string;
  /** Its vendor, as `metadata.product.vendor_name`. */
  readonly vendor: string;
  /** The build reporting this, as `metadata.product.version`. */
  readonly version: string;
}

/**
 * One line of the feed: an OCSF Entity Management event.
 *
 * Every field here is either a constant of the class, a fact of the envelope, or the
 * producer's own name. There is no member that could hold a body — which is the shape of
 * the promise, said in the type.
 */
export interface AuditEvent {
  readonly activity_id: number;
  readonly activity_name: string;
  readonly category_uid: number;
  readonly class_uid: number;
  readonly type_uid: number;
  readonly severity_id: number;
  readonly status_id: number;
  /** When the fact happened, normalized to epoch milliseconds as the class requires. */
  readonly time: number;
  readonly metadata: AuditMetadata;
  readonly entity: AuditEntity;
  readonly actor: AuditActor;
}

/** The `metadata` of one line: who reported it, from which log, in which native shape. */
export interface AuditMetadata {
  readonly version: string;
  readonly product: {
    readonly name: string;
    readonly vendor_name: string;
    readonly version: string;
  };
  /**
   * The mnema kind, VERBATIM — `metadata.event_code` is the schema's field for the
   * source's own event identifier, and it is where the exact kind survives a
   * normalization that necessarily loses some of it. `channel.switched` and
   * `task.transitioned` are both `Update`; only this tells them apart.
   */
  readonly event_code: string;
  /** The version of that kind's own contract, as the log schema version of the original. */
  readonly log_version: string;
  /**
   * Which TREE the fact lives in — the log this line was read from.
   *
   * It is on every line because it is the difference between a fact that is committed and
   * clones to every machine and a fact that is on one disk. `exposure` takes the trees
   * separately for exactly this reason, and a feed that merged them would hand a SIEM one
   * pile in which that distinction cannot be recovered.
   */
  readonly log_name: string;
  /** The `at` of the record, in its native ISO-8601 form, unnormalized. */
  readonly original_time: string;
  /** The run, when the fact belongs to one — what correlates the facts of one session. */
  readonly correlation_uid?: string;
}

/** The entity the fact moved. */
export interface AuditEntity {
  readonly uid: string;
  readonly type: string;
  readonly type_id: number;
}

/** Who authorized the fact, attested by which key, executed by which agent. */
export interface AuditActor {
  readonly user: {
    /** The authorizing human — the anchor id, derived from a key and unforgeable. */
    readonly uid: string;
    /**
     * The fingerprint of the key that SIGNED the fact. `credential_uid` is the schema's
     * field for the identifier of a user's credential, which is what a fingerprint is: it
     * names the key without being usable as one.
     */
    readonly credential_uid: string;
  };
  /** The agent that executed the fact, when one did. */
  readonly app_name?: string;
}

/**
 * One envelope written as one OCSF event.
 *
 * `tree` is the log the event was read from, and it is a parameter rather than a field of
 * the envelope because a tree is where a fact is KEPT, which the fact itself does not say.
 */
export function auditEvent(
  envelope: AuditEnvelope,
  tree: string,
  producer: AuditProducer,
): AuditEvent {
  const mapping = AUDIT_BY_KIND[envelope.kind];
  return {
    activity_id: mapping.activity.id,
    // The schema fixes this: the caption for every activity but `99`, where the
    // source-specific label is required instead. Both come from the one pairing above.
    activity_name: mapping.activity === ACTIVITY.other ? envelope.kind : mapping.activity.caption,
    category_uid: OCSF_CATEGORY_UID,
    class_uid: OCSF_CLASS_UID,
    type_uid: OCSF_CLASS_UID * 100 + mapping.activity.id,
    severity_id: SEVERITY_INFORMATIONAL,
    status_id: STATUS_SUCCESS,
    time: Date.parse(envelope.at),
    metadata: {
      version: OCSF_SCHEMA_VERSION,
      product: {
        name: producer.product,
        vendor_name: producer.vendor,
        version: producer.version,
      },
      event_code: envelope.kind,
      log_version: String(envelope.v),
      log_name: tree,
      original_time: envelope.at,
      ...(envelope.run !== undefined ? { correlation_uid: envelope.run } : {}),
    },
    entity: {
      uid: envelope.subject,
      type: mapping.entityType,
      type_id: mapping.entityTypeId,
    },
    actor: {
      user: { uid: envelope.who, credential_uid: envelope.signerFp },
      ...(envelope.which !== undefined ? { app_name: envelope.which } : {}),
    },
  };
}

/**
 * The whole feed: every tree's events that the filter selects, each written as one audit
 * event, tree by tree in the order the caller listed them.
 *
 * IT IS NOT RE-SORTED ACROSS TREES, and that is the reading rather than an omission. Each
 * tree's events arrive in the order that chain PROVES; a cross-tree ordering imposed here
 * would be a second ordering rule, answering with an order the record never stated. A
 * consumer that wants one timeline sorts on `time`, which every line carries — and the
 * `log_name` that would be lost in a merge is what a reader needs to tell a committed fact
 * from one that never left the disk.
 *
 * The filter is {@link matchesAuthorship}, the same declared window `accountability`
 * narrows by — one wording of `--from`/`--to`/`--who`/`--which`, so a feed and a count
 * over the same record cannot come to disagree about which facts are in scope.
 */
export function auditFeed(
  sources: readonly ScopedEvents[],
  producer: AuditProducer,
  filter: AuthorshipFilter = {},
): AuditEvent[] {
  const feed: AuditEvent[] = [];
  for (const source of sources) {
    for (const event of source.events) {
      if (!matchesAuthorship(event, filter)) continue;
      feed.push(auditEvent(event, source.scope, producer));
    }
  }
  return feed;
}
