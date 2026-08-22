/**
 * The canonicalization vectors: a fixed event per catalog kind, and the table
 * that will not compile until a new kind has one.
 *
 * WHAT THEY ARE FOR. The property tests next door prove canonicalization is
 * deterministic, key-sorted and Unicode-normalized. They do NOT pin the ACTUAL
 * bytes: a refactor could change the byte layout while keeping every property
 * intact, and every existing test would stay green — silently breaking the
 * ability of an older clone (or a signed checkpoint) to reproduce the same
 * content root. The digests frozen against these events are that floor, and they
 * are published as data (`canonical-vectors.json`, described by `FORMAT.md`) so
 * an implementation nobody here wrote can check itself against them.
 *
 * WHY THE TABLE IS IN `src` AND NOT IN THE TEST. It used to be a `const` inside
 * `canonical-vectors.test.ts`, and the doc-comment there claimed it held "a
 * representative event of every kind". It held nine of twenty — the nine oldest —
 * and nothing obliged a kind added later to gain one, so the regression floor
 * stopped following the catalog the moment the catalog grew. The fix has to be a
 * TYPE, because a hand-kept list is what failed; and the type has to live here,
 * because `tsc -b` excludes `src/**\/*.test.ts` and vitest strips types without
 * checking them — a mapped type declared in a test file is vacuous by
 * construction. So the table is a module of the package, in the shape
 * `core/src/topology/routing.ts` uses for the same obligation: a member added to
 * {@link EventKind} does not compile until it has a row.
 *
 * The row type is a NON-EMPTY tuple, not an array: `readonly Vector[]` is
 * satisfied by `[]`, which would let a kind be listed with no vector at all and
 * keep the compiler quiet.
 *
 * THE COST, SAID OUT LOUD: this module is data with no production caller, so it
 * compiles into `dist` and is carried by a package that never reads it at run
 * time. That is the price of the guard being a compile error instead of a hope,
 * and it is the same price `UNROUTED_KINDS` pays.
 *
 * THE ENVELOPE IS FIXED ON PURPOSE — one instant, one anchor, one fingerprint —
 * so the digests are reproducible by a reader who has neither our clock nor our
 * keys. Nothing here is random and nothing is derived from the machine.
 */

import {
  channelAsked,
  channelServed,
  channelSwitched,
  decisionRecorded,
  decisionTransitioned,
  handoffRecorded,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  knowledgeLinked,
  memoryCaptured,
  observationRecorded,
  runEnded,
  runStarted,
  skillConsulted,
  skillCreated,
  skillTransitioned,
  tailPruned,
  taskCreated,
  taskTransitioned,
} from './build.js';
import type { CatalogEvent, EventKind } from './catalog.js';

/** One vector: a stable name and the fixed event whose canonical bytes are frozen. */
export interface CanonicalVector {
  /**
   * A stable, unique label. It is the key the published artifact is joined on, so
   * renaming one is a change to the artifact and shows up as a diff, never as a
   * silent re-pairing.
   */
  readonly name: string;
  /** The event, built through the builders — the shape a writer actually produces. */
  readonly event: CatalogEvent;
}

/** The one instant every vector is stamped with. */
export const VECTOR_AT = '2026-07-21T00:00:00.000Z';

/**
 * The anchor that authorized every vector. `who` is an anchor id (`mnid:<hash>`)
 * and not a typed-in name, so the frozen digests pin the real envelope shape —
 * the one an operation derives from its key.
 */
export const VECTOR_WHO = 'mnid:1111111111111111111111111111111111111111111111111111111111111111';

/** The full fingerprint of the key that signed every vector. */
export const VECTOR_SIGNER_FP = '2222222222222222222222222222222222222222222222222222222222222222';

/** A second fingerprint: the key an enrollment vouches for and a revocation removes. */
export const VECTOR_NEW_FP = '3333333333333333333333333333333333333333333333333333333333333333';

/**
 * The head hash a waiver names, and the installation half of the tail id it cuts.
 * A tail id is `<fingerprint>-<installationId>` (see `chain/layout.ts`), so the
 * vector's tail is built from the same fingerprint the envelope signs with.
 */
const VECTOR_THROUGH_HASH = '4444444444444444444444444444444444444444444444444444444444444444';
const VECTOR_INSTALLATION = '55555555555555555555555555555555';

/**
 * The minted ids the vectors refer to.
 *
 * They are UUID v7 written the way `mintId` writes one — the 48-bit millisecond
 * prefix is {@link VECTOR_AT} itself, so an id in a vector and the instant of the
 * fact it belongs to agree, and the last group is a counter rather than entropy so
 * the file stays readable. A subject the product mints is a v7; the nine oldest
 * vectors predate that and carry `t-1`, `d-1`, `r-1`, which no operation of this
 * product could ever produce. Their digests are frozen, so they stay as they are
 * and the discrepancy is recorded here rather than papered over.
 */
const MEMORY_ID = '019f81f8-e400-7001-8000-000000000001';
const OBSERVATION_ID = '019f81f8-e400-7002-8000-000000000002';
const TASK_ID = '019f81f8-e400-7003-8000-000000000003';
const SKILL_ID = '019f81f8-e400-7004-8000-000000000004';
const RUN_ID = '019f81f8-e400-7005-8000-000000000005';
const RULE_ID = '019f81f8-e400-7006-8000-000000000006';

/**
 * The channels the three `channel.*` vectors name.
 *
 * They are the product's real channel names, spelled here as literals because
 * this package is the proof engine and knows nothing about the surfaces — the
 * vocabulary lives in `code/src/record-framing.ts`. That a literal here still
 * names a channel the product HAS is checked from the other side, where the
 * vocabulary is: `code/tests/the-vectors-hold-what-the-product-produces.test.ts`.
 */
const PUSH_CHANNEL = 'edit-rules-push';
const DOCUMENT_CHANNEL = 'brief-document';
const ASKS_CHANNEL = 'edit-asks-a-person';

/** The envelope of a fact an agent carried out. */
const agent = (
  subject: string,
  run?: string,
): {
  at: string;
  who: string;
  signerFp: string;
  which: string;
  subject: string;
  run?: string;
} => ({
  at: VECTOR_AT,
  who: VECTOR_WHO,
  signerFp: VECTOR_SIGNER_FP,
  which: 'claude',
  subject,
  ...(run === undefined ? {} : { run }),
});

/** The envelope of a fact no agent executed — a person's own, or an identity fact. */
const person = (
  subject: string,
): {
  at: string;
  who: string;
  signerFp: string;
  subject: string;
} => ({ at: VECTOR_AT, who: VECTOR_WHO, signerFp: VECTOR_SIGNER_FP, subject });

/**
 * A representative event per kind, and the ORDER the published artifact lists
 * them in. Declaration order is the artifact's order and the order the aggregate
 * content root folds them in, so moving a row is a visible change to the file.
 *
 * The rows are the catalog's own kind order (`LATEST_VERSION`), not the order the
 * nine oldest vectors happened to be written in.
 */
export const CANONICAL_VECTORS: {
  readonly [K in EventKind]: readonly [CanonicalVector, ...CanonicalVector[]];
} = {
  'run.started': [
    {
      name: 'run.started',
      event: runStarted(person('r-1'), { agent: 'claude', goal: 'do the thing' }),
    },
  ],
  'run.ended': [{ name: 'run.ended', event: runEnded(person('r-1'), { outcome: 'ok' }) }],
  'task.created': [
    { name: 'task.created', event: taskCreated(agent('t-1'), { title: 'Ship the parser' }) },
    {
      // A title written DECOMPOSED — "cafe" followed by U+0301, the combining
      // acute — must canonicalize to the same bytes, and so the same digest, as
      // the composed form. The frozen hash pins the normalized result, so a change to
      // normalization is a change to the format and is caught here. The published
      // artifact carries the decomposed spelling, which is what makes the vector
      // mean anything to a reader who did not write this comment.
      name: 'task.created (an NFD title normalizes to NFC)',
      event: taskCreated(agent('t-2'), { title: 'cafe\u0301' }),
    },
  ],
  'task.transitioned': [
    {
      name: 'task.transitioned (birth, from: null)',
      event: taskTransitioned(agent('t-1'), { from: null, to: 'todo', action: 'create' }),
    },
    {
      name: 'task.transitioned (with proof fields)',
      event: taskTransitioned(agent('t-1'), {
        from: 'todo',
        to: 'done',
        action: 'finish',
        fields: { note: 'shipped', pr_url: 'https://example.test/pr/1' },
      }),
    },
    {
      // THE TWO ROWS ABOVE FREEZE A VOCABULARY NO OPERATION OF THIS PRODUCT CAN
      // WRITE. Their states and action are `todo`, `done` and `finish`; the task
      // workflow's states are `DRAFT`, `READY`, `IN_PROGRESS`, `BLOCKED`,
      // `IN_REVIEW`, `DONE`, `CANCELED` and its moves are `submit`, `start`,
      // `complete` and the rest — so a gate could never have produced either. The
      // catalog permits it (a transition's `from`/`to`/`action` are open literal
      // strings on purpose, so a fact stays legible when the workflow changes), and
      // the bytes are legitimate bytes; what they are not is an example of a fact.
      // Their digests are frozen, so they stay, and this row is what gives the
      // artifact one transition an operation of this product could actually have
      // written. The two are named as the closed exception where the guard over
      // that lives: `code/tests/the-vectors-hold-what-the-product-produces.test.ts`.
      name: 'task.transitioned (a move the task workflow allows)',
      event: taskTransitioned(agent(TASK_ID), {
        from: 'IN_PROGRESS',
        to: 'DONE',
        action: 'complete',
        fields: { note: 'the parser ships' },
      }),
    },
  ],
  'decision.recorded': [
    {
      name: 'decision.recorded',
      event: decisionRecorded(agent('d-1'), {
        title: 'Use SQLite for the cache',
        rationale: 'The load is relational.',
        adr: 'ADR-3',
      }),
    },
  ],
  'decision.transitioned': [
    {
      name: 'decision.transitioned (supersede, with `by`)',
      event: decisionTransitioned(agent('d-1'), {
        from: 'accepted',
        to: 'superseded',
        action: 'supersede',
        by: 'd-2',
        fields: { reason: 'r' },
      }),
    },
  ],
  // The enrollment kinds' subject is the anchor (`mnid:<hash>`), not a task or
  // decision id, and they carry no `which` — they are identity facts, not agent
  // work. Freezing their bytes pins that shape so an enrollment written now stays
  // reproducible by a clone that verifies the fold later.
  'identity.founded': [
    {
      name: 'identity.founded (self-signed by the founder)',
      event: identityFounded(person(VECTOR_WHO), { foundingFp: VECTOR_SIGNER_FP }),
    },
  ],
  'key.enrolled': [
    {
      name: 'key.enrolled (member vouches for a new key)',
      event: keyEnrolled(person(VECTOR_WHO), {
        newFp: VECTOR_NEW_FP,
        reverseSig: 'ab'.repeat(32),
      }),
    },
  ],
  'key.revoked': [
    {
      name: 'key.revoked (prospective removal)',
      event: keyRevoked(person(VECTOR_WHO), {
        revokedFp: VECTOR_NEW_FP,
        reason: 'key rotation',
      }),
    },
  ],
  'memory.captured': [
    {
      name: 'memory.captured',
      event: memoryCaptured(agent(MEMORY_ID), {
        content: 'The cache is SQLite because the load is relational.',
      }),
    },
  ],
  'observation.recorded': [
    {
      // Its subject is its OWN minted id and the observed entity is named in the
      // payload: what is pinned here is that separation, which is what keeps two
      // observations about one task from colliding on a subject.
      name: 'observation.recorded',
      event: observationRecorded(agent(OBSERVATION_ID), {
        about: TASK_ID,
        topic: 'flake',
        text: 'The suite reddens on a cold cache, about once in twenty runs.',
      }),
    },
  ],
  'handoff.recorded': [
    {
      // `fromAgent == toAgent` is the legitimate case the catalog names — a chat
      // restart with the same agent — so it is the one worth freezing: a reader
      // that "helpfully" refused it would refuse a fact this product writes.
      name: 'handoff.recorded (a restart with the same agent)',
      event: handoffRecorded(agent(TASK_ID), { fromAgent: 'claude', toAgent: 'claude' }),
    },
  ],
  'knowledge.linked': [
    {
      name: 'knowledge.linked (relates-to)',
      event: knowledgeLinked(agent(MEMORY_ID), { target: TASK_ID, rel: 'relates-to' }),
    },
  ],
  'skill.created': [
    {
      name: 'skill.created',
      event: skillCreated(agent(SKILL_ID), {
        name: 'Close the sprint before merging',
        body: 'One sprint is active at a time: close it, then merge.',
      }),
    },
  ],
  'skill.transitioned': [
    {
      // A legal move of the skill workflow, carrying the proof that move requires
      // (`reviewed --adopt--> adopted`, which requires a note). A vector whose
      // triple no workflow allows would freeze bytes of a fact the product cannot
      // write; the guard that says this one is legal lives where the workflow does.
      name: 'skill.transitioned (adopt, with the note the move requires)',
      event: skillTransitioned(agent(SKILL_ID), {
        from: 'reviewed',
        to: 'adopted',
        action: 'adopt',
        fields: { note: 'in use on three tasks' },
      }),
    },
  ],
  'skill.consulted': [
    {
      // The payload is empty and that is the whole shape: the fact is entirely
      // envelope. It is the one vector that pins `payload: {}` canonicalizing to
      // `{}` rather than being dropped, and — with `run` present — the optional
      // envelope field that had no frozen bytes at all before.
      name: 'skill.consulted (empty payload, inside a run)',
      event: skillConsulted(agent(SKILL_ID, RUN_ID)),
    },
  ],
  'tail.pruned': [
    {
      name: 'tail.pruned (a whole tail, authorized before the cut)',
      event: tailPruned(person(VECTOR_WHO), {
        tail: `${VECTOR_SIGNER_FP}-${VECTOR_INSTALLATION}`,
        throughHash: VECTOR_THROUGH_HASH,
        eventCount: 402,
        reason: 'the machine was decommissioned',
      }),
    },
  ],
  'channel.switched': [
    {
      // The catalog's only boolean payload field, and the reason it is a boolean
      // rather than a literal: `false`, `"off"` and a missing key would be three
      // spellings of one fact. The frozen bytes are what make `false` the only one.
      name: 'channel.switched (off, with a reason)',
      event: channelSwitched(person(PUSH_CHANNEL), {
        on: false,
        reason: 'the push is noisy in this repository',
      }),
    },
  ],
  'channel.served': [
    {
      name: 'channel.served (empty payload, inside a run)',
      event: channelServed(agent(DOCUMENT_CHANNEL, RUN_ID)),
    },
  ],
  'channel.asked': [
    {
      name: 'channel.asked (a rule asked for a person, at a path)',
      event: channelAsked(agent(ASKS_CHANNEL, RUN_ID), {
        rule: RULE_ID,
        path: 'src/billing/rounding.ts',
      }),
    },
  ],
};

/**
 * Every vector, flattened in the table's declaration order.
 *
 * It walks `Object.values` of the table rather than a second list of kinds: a
 * kind added to the catalog reaches this the moment it compiles, and there is no
 * order to keep in step by hand.
 */
export function canonicalVectors(): readonly CanonicalVector[] {
  return Object.values(CANONICAL_VECTORS).flat();
}

/**
 * Where the published artifact is, resolved from this module.
 *
 * ONE site for the path: the test that checks the digests, the guard that checks
 * `FORMAT.md`, and the sentence in `FORMAT.md` that tells a stranger where to
 * download it all have to name the same file, and a path typed in three places
 * is three paths that can come to differ. The depth is the same from `src/events/`
 * and from `dist/events/`, so it resolves in the suite and in the built package.
 */
export const VECTORS_FILE_NAME = 'canonical-vectors.json';
export const VECTORS_FILE = new URL(`../../${VECTORS_FILE_NAME}`, import.meta.url);
