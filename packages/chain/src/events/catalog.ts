/**
 * The event catalog: the closed, typed set of facts the chain can contain.
 *
 * The catalog is the single source of what a valid event looks like. It is a
 * discriminated union keyed by `kind`, each arm pinning its payload contract
 * and its version. Nothing outside this union may be appended — a fact the
 * catalog does not describe is not a fact the chain promises to prove.
 *
 * Adding a kind is a deliberate design change (a new thing we promise to
 * prove), not an arbitrary runtime shape. Changing what a published payload
 * MEANS is never an in-place edit: it is a new version plus an upcaster, so an
 * event written under an old contract stays readable and reproducible forever.
 *
 * WHAT THAT RULE DOES AND DOES NOT COVER, measured rather than assumed. The
 * purpose is the clause at the end — an already-written event stays reproducible
 * — and it is the purpose that decides, because the mechanism cannot serve every
 * shape of change:
 *
 *   - A field ADDED as OPTIONAL is not a version bump. Nothing already written
 *     changes: an old event omits the field, parses, and canonicalizes to the
 *     same bytes it always did, so its entry hash and the content root a
 *     checkpoint signed both still match. `alternatives` on `decision.recorded`
 *     is exactly this case (`parse.test.ts`, "reads a decision recorded before
 *     `alternatives` existed").
 *   - A version bump is for a change that would otherwise make an old event
 *     UNREADABLE or make an existing field mean something else — the cases where
 *     leaving the shape alone is what loses the past.
 *
 * And the reason the first case must not take a bump anyway: an upcaster raises
 * `v` by one, `v` is part of the canonical bytes, and both the entry hash and the
 * content root are RECOMPUTED from the event a reader reconstructed. So lifting
 * an already-written event changes its bytes, and verify reports "entry hash
 * mismatch: content or link was altered" on a chain nobody touched. Measured on a
 * two-event chain with a `(decision.recorded, 1) -> 2` lift registered: green
 * before, one T1 issue after. Bumping to protect the past would break it. This is
 * a real limit of the ladder, not of this field — it is written down here because
 * this is where the next person will come to ask.
 *
 * States and actions are stored as literal strings, never pointers into the
 * workflow. A pointer rots when the workflow changes; a literal is a
 * self-describing fact that an upcaster can migrate and an anonymous reader can
 * understand without any other context.
 */

import type { Envelope } from './envelope.js';

/** A run began: the human on the envelope authorized this session. */
export interface RunStartedV1 extends Envelope {
  readonly kind: 'run.started';
  readonly v: 1;
  /** Subject is the run's own id. */
  readonly payload: {
    /** The agent this run is for (the `which` for the run's actions). */
    readonly agent: string;
    /** Optional stated goal of the session. */
    readonly goal?: string;
  };
}

/** A run ended: this session stopped. */
export interface RunEndedV1 extends Envelope {
  readonly kind: 'run.ended';
  readonly v: 1;
  /** Subject is the run's own id. */
  readonly payload: {
    /** Optional short outcome note. */
    readonly outcome?: string;
  };
}

/** A task was created. */
export interface TaskCreatedV1 extends Envelope {
  readonly kind: 'task.created';
  readonly v: 1;
  /** Subject is the task's id. */
  readonly payload: {
    readonly title: string;
  };
}

/**
 * The proof carried by a transition: the textual why of the move, plus optional
 * context. Which of these a given action must carry is the workflow gate's rule,
 * enforced once at write time — the catalog only pins their SHAPE, never which
 * action requires which field. Keeping the requirement out of the type is
 * deliberate: `action` is an open literal string so the workflow can grow new
 * actions without touching this zero-dependency catalog, and an event written
 * under an old workflow stays readable forever. If the payload varied by action
 * instead, a historical action the current catalog no longer lists would be
 * rejected on read — the very drift the literal-string design exists to avoid.
 *
 * Every field is optional here; the gate is what makes one mandatory for a given
 * action. A reader replays the fact as written and does not re-judge it.
 */
export interface TransitionFields {
  /** Why a task was canceled, blocked, or reopened. */
  readonly reason?: string;
  /** What was done when completing or approving. */
  readonly note?: string;
  /** What must change when review is not approved. */
  readonly feedback?: string;
  /** A pull request for the work, when one exists. Never required. */
  readonly pr_url?: string;
  /** Any further context links, when they exist. */
  readonly links?: readonly string[];
}

/**
 * A task moved between workflow states. `from`/`to`/`action` are literal
 * strings — the fact of the transition as it happened, not a reference to a
 * workflow that may since have changed.
 *
 * `from` is `null` for exactly one transition: the one that gives a task its
 * initial state at birth. A task's state is never carried by its creation
 * event; it is only ever established by a transition, and the birth transition
 * (`from: null`, `action: "create"`) is the first of them. That single rule —
 * "current state is the `to` of the last transition" — reads state without ever
 * consulting the workflow, so replaying a task written long ago yields the
 * state that was recorded, not one re-derived from a workflow that has since
 * moved on.
 *
 * `fields` carries the transition's proof (the why, links). It is optional at
 * this layer; the workflow gate decides which fields a given action must carry.
 */
export interface TaskTransitionedV1 extends Envelope {
  readonly kind: 'task.transitioned';
  readonly v: 1;
  /** Subject is the task's id. */
  readonly payload: {
    /** The state left behind, or `null` when this is the birth transition. */
    readonly from: string | null;
    readonly to: string;
    readonly action: string;
    /** The transition's proof and context; omitted when it carries none. */
    readonly fields?: TransitionFields;
  };
}

/**
 * A decision was recorded — the birth of an architecture decision.
 *
 * Unlike a task, whose creation event carries only a title, a decision's fact
 * is its WHY: `rationale` is part of the immutable record, because a decision
 * with no rationale records nothing worth proving. `adr` is the citable label
 * (`ADR-<n>`) frozen at write time — a sequential number derived from how many
 * decisions the writer's local view already held. It is FROZEN into the fact,
 * never re-derived on read: a number derived on read would slip when a
 * concurrent decision merges in ahead of it, and a citation ("ADR-2") would
 * silently come to point at a different decision. The number is a citation
 * label over the id, not identity and not a fatal constraint — two clones may
 * mint the same `adr` offline; the ids stay unique and a projection surfaces
 * the label collision.
 *
 * `alternatives` is the OTHER half of the why: what was considered and turned
 * down, and for what reason. It is optional because many decisions had no real
 * contender, and it is TEXT rather than a list of options because the content
 * door screens flat text fields — a nested shape would oblige the door to
 * recurse, and a credential escaping through a nested field would regress the
 * one guarantee it gives. It is not called `rejected`: that is a decision STATE,
 * and one word meaning both a workflow position and a paragraph of prose is a
 * word nobody can read twice the same way.
 *
 * IT IS WRITTEN AT BIRTH, because this event is immutable. There is no operation
 * that adds an `alternatives` to a decision already recorded, and there will not
 * be one: a rejected option discovered later is a NEW decision, or a supersession
 * of this one — which is how the product already handles changing its mind. The
 * record gains the later reasoning as a later fact, in order, rather than by
 * editing what was proven.
 *
 * Optional, and the absence is a REPORTABLE fact rather than an unknown: the
 * field is NAMED, so a reader can ask "did this decision record what it turned
 * down?" — a question a section convention inside `rationale` could never answer,
 * because prose is not interrogable.
 */
export interface DecisionRecordedV1 extends Envelope {
  readonly kind: 'decision.recorded';
  readonly v: 1;
  /** Subject is the decision's id. */
  readonly payload: {
    readonly title: string;
    /** The why of the decision — the whole value of an ADR. */
    readonly rationale: string;
    /** The citable label, `ADR-<n>`, frozen at write time. */
    readonly adr: string;
    /**
     * What was considered and turned down, and why not. Absent when the decision
     * had no alternative worth recording — absent, never empty.
     */
    readonly alternatives?: string;
  };
}

/**
 * A decision moved between workflow states. Mirrors `task.transitioned`:
 * `from`/`to`/`action` are literal strings — the fact of the move, not a
 * pointer into a workflow that may since have changed — and `fields` carries
 * the transition's textual proof (the gate decides which is mandatory).
 *
 * `by` is the one shape a decision transition carries that a task's does not:
 * the id of the decision that SUPERSEDES this one. It is a typed relational id
 * in the payload (never smuggled into `fields`, which is textual proof), so a
 * `supersede` records, as an autonomous fact, exactly which decision replaced
 * which. It is present only on a supersede and absent otherwise. This is the
 * first multi-entity event: its subject is the superseded decision, and `by`
 * names the successor — the model for every relational fact that follows.
 *
 * `from` is `null` for exactly one transition: the birth that gives a decision
 * its initial state. The same rule as tasks — current state is the `to` of the
 * last transition, read without ever consulting the workflow.
 */
export interface DecisionTransitionedV1 extends Envelope {
  readonly kind: 'decision.transitioned';
  readonly v: 1;
  /** Subject is the decision's id (the superseded one, on a supersede). */
  readonly payload: {
    /** The state left behind, or `null` when this is the birth transition. */
    readonly from: string | null;
    readonly to: string;
    readonly action: string;
    /** The successor decision's id — present only on a `supersede`. */
    readonly by?: string;
    /** The transition's proof and context; omitted when it carries none. */
    readonly fields?: TransitionFields;
  };
}

/**
 * An identity was founded — the birth of an anchor. The founding key declares
 * itself the first member of the identity it derives.
 *
 * The subject is the anchor, and the anchor is DERIVED from the founding key,
 * not chosen: the verifier requires `subject == deriveAnchor(foundingFp)`, so no
 * one can found an identity onto a key they do not hold. The event is
 * self-signed — the founding key both authorizes (`who` = the anchor) and signs
 * (`signerFp` == `foundingFp`) — because at founding there is no prior member to
 * vouch for it. This is the root of the enrollment fold: the one member that
 * every later `key.enrolled` chains back to.
 */
export interface IdentityFoundedV1 extends Envelope {
  readonly kind: 'identity.founded';
  readonly v: 1;
  /** Subject is the anchor (`mnid:<hash>`) this founds. */
  readonly payload: {
    /** The founding key's full fingerprint — the anchor derives from it. */
    readonly foundingFp: string;
  };
}

/**
 * A key was enrolled into an identity — a member key vouches for a new one.
 *
 * `signerFp` is a key ALREADY valid for the anchor at this point in the chain
 * (the founder, or a previously enrolled key); it authorizes the new key's
 * membership. `newFp` is the key being brought in. `reverseSig` is the new key's
 * OWN Ed25519 signature over the message `enroll:<anchor>:<newFp>` — a
 * proof-of-possession that binds the enrollment to this exact anchor and this
 * exact new key, so an existing member cannot fold an unwilling third party's
 * key into the identity, and a captured reverse-signature cannot be replayed to
 * enroll the same key into a DIFFERENT anchor.
 *
 * The verifier accepts it only when both hold: `signerFp` is valid for the
 * anchor at this point, and `reverseSig` verifies against `newFp` over that
 * message. Neither alone suffices — the first stops a stranger from
 * self-enrolling, the second stops a member from enrolling a key they do not
 * control.
 */
export interface KeyEnrolledV1 extends Envelope {
  readonly kind: 'key.enrolled';
  readonly v: 1;
  /** Subject is the anchor the key joins. */
  readonly payload: {
    /** The full fingerprint of the key being enrolled. */
    readonly newFp: string;
    /** `newFp`'s hex Ed25519 signature over `enroll:<anchor>:<newFp>`. */
    readonly reverseSig: string;
  };
}

/**
 * A key was revoked from an identity — a member key retires another (or itself).
 *
 * `signerFp` is a key valid for the anchor at this point; `revokedFp` is the key
 * it removes. Revocation is by PEERS and PROSPECTIVE: any valid member may
 * revoke any other (including the founder and itself, with no hierarchy), and
 * removal takes effect from this point FORWARD only. Events the revoked key
 * signed BEFORE this point stay valid — the log is immutable, and a past fact
 * proven by a then-valid key does not become unproven when the key later
 * retires. `reason` records the why of the revocation, part of the fact.
 */
export interface KeyRevokedV1 extends Envelope {
  readonly kind: 'key.revoked';
  readonly v: 1;
  /** Subject is the anchor the key is removed from. */
  readonly payload: {
    /** The full fingerprint of the key being revoked. */
    readonly revokedFp: string;
    /** Why the key was revoked — the proof of the why. */
    readonly reason: string;
  };
}

/**
 * AN IDENTITY DECLARED ONE OF ITS KEYS A BACKUP: a key kept off the machine, which signs
 * nothing until it is restored, so its having no tail is what is expected of it.
 *
 * `who` is the anchor and `subject` the same anchor — an identity declares only its own keys —
 * and `signerFp` a key valid for it at this point. `backupFp` must be a member of the anchor at
 * this point too: a declaration naming a key the identity does not hold is refused.
 *
 * It adds and removes no key, and it vouches for nothing a key signs; what it changes is how a
 * reader SAYS a committed key with no tail (FORMAT.md section 6.5). Like a revocation it takes
 * effect only when it is itself signature-covered: a declaration a party with no key appended
 * above the last checkpoint would otherwise silence the warning about a tail it removed.
 */
export interface BackupDeclaredV1 extends Envelope {
  readonly kind: 'backup.declared';
  readonly v: 1;
  /** Subject is the anchor whose backup the key is. */
  readonly payload: {
    /** The full fingerprint of the key kept as the identity's backup. */
    readonly backupFp: string;
  };
}

/**
 * A memory was captured — a point-in-time fact of knowledge.
 *
 * This is a POINTLESS fact in the workflow sense: it has no state and no birth
 * pair. A memory does not move through a lifecycle, so nothing about it is ever
 * re-derived on read; there is exactly one event, and replaying it a thousand
 * times yields the identical fact. That is why it needs no `from: null`
 * transition the way a task or decision does — the birth pair exists only to
 * pin an initial STATE, and a fact that has no state has no state to pin. What
 * proves the memory is the envelope the catalog already carries: `who` captured
 * it, `at` when, `subject` is the memory's own minted id. The payload adds only
 * the one thing the envelope does not: the `content` itself.
 *
 * "Superseded", "revised", or "obsolete" is never a field here — the fact is
 * immutable. Those are LATER facts (a relational link or a tombstone) that a
 * projection respects; the captured memory itself never changes.
 */
export interface MemoryCapturedV1 extends Envelope {
  readonly kind: 'memory.captured';
  readonly v: 1;
  /** Subject is the memory's own id. */
  readonly payload: {
    /** The captured content. */
    readonly content: string;
  };
}

/**
 * An observation was recorded — a point-in-time note ABOUT an entity.
 *
 * Like a memory, an observation is a fact with no state and no birth pair: one
 * event is the whole of it, and replaying it yields the identical fact. It
 * differs from a memory in what its subject is. A memory's subject is its OWN
 * minted id (the memory IS the entity). An observation is a note about
 * SOMETHING ELSE — a task, a decision — so it mints its OWN id as the subject
 * (an observation is itself an entity: "I noted X about Y") and names the
 * observed entity in the payload as `about`. Its own id keeps two observations
 * on the same entity from colliding on one subject; the `about` link is the
 * relation to what was observed. That link is not verified against the writer's
 * tree at write time — the observed entity may live in another tree — so it is
 * an ASSERTED fact, resolved on read against the union like any cross-tree link.
 */
export interface ObservationRecordedV1 extends Envelope {
  readonly kind: 'observation.recorded';
  readonly v: 1;
  /** Subject is the observation's OWN minted id. */
  readonly payload: {
    /** The id of the entity this observation is about (a task, decision, …). */
    readonly about: string;
    /** A short topic label for the observation. */
    readonly topic: string;
    /** The observation itself. */
    readonly text: string;
  };
}

/**
 * A NOTE WAS RETRACTED — a memory or an observation taken back out of what the record
 * serves, by a later fact that says who took it back and why.
 *
 * It is the tombstone the memory's own doc promised: "superseded", "revised" or
 * "obsolete" is never a field on the captured fact, which is immutable, but a LATER fact
 * a projection respects. Nothing is erased: the note's own event stays where it was, a
 * verifier still sees it, and the read that opens it by id still serves it, saying it was
 * retracted. What changes is what the reads that LIST notes offer — the opening of a
 * session, the search, the counts — which no longer serve it as standing knowledge.
 *
 * ITS SUBJECT IS THE NOTE, as a supersede's subject is the superseded decision: the
 * history of one note is read under its one id. `who` is who took it back, as on every
 * fact; the payload adds the one thing the envelope does not carry, the REASON — a
 * retraction that cannot say why is the record forgetting on somebody's preference.
 *
 * ONLY NOTES. Decisions and patterns keep their own lifecycle (rejected, superseded,
 * deprecated), which says more than "taken back" does; a retraction of one is refused at
 * the door, not recorded.
 */
export interface NoteRetractedV1 extends Envelope {
  readonly kind: 'note.retracted';
  readonly v: 1;
  /** Subject is the retracted note's id — a memory's or an observation's. */
  readonly payload: {
    /** Why the note was taken back. Never optional, never empty. */
    readonly reason: string;
  };
}

/**
 * A handoff was recorded — a fact that work on a task passed from one agent to
 * another (or restarted with the same agent).
 *
 * A handoff is a point-in-time fact ABOUT a task: its subject IS the task, not a
 * fresh id. That is deliberate and unlike an observation — a handoff has no
 * standalone identity worth minting; it is an entry in the task's own history.
 * Multiple handoffs on one task carry the same subject and do NOT collide,
 * because each is a distinct event with its own chain link, and the projection
 * accumulates them into a LIST on the task rather than overwriting last-write.
 *
 * `fromAgent == toAgent` is legitimate: it records a chat restart with the same
 * agent. A handoff always needs a task for context — a pure session restart with
 * no task is a new run, not a handoff, and is not recorded here.
 */
export interface HandoffRecordedV1 extends Envelope {
  readonly kind: 'handoff.recorded';
  readonly v: 1;
  /** Subject is the TASK the handoff is about. */
  readonly payload: {
    /** The agent handing off. */
    readonly fromAgent: string;
    /** The agent taking over (may equal `fromAgent`: a chat restart). */
    readonly toAgent: string;
  };
}

/**
 * A piece of knowledge was linked to another — the first RELATIONAL fact of the
 * knowledge domain. Its subject is the entity that ORIGINATES the link (the
 * memory/task/decision that "relates to" the target); `target` is the id it
 * points at, and `rel` is the relation label.
 *
 * Two shapes matter, both chosen to mirror facts the catalog already proves:
 *   - `target` is an UNVERIFIED reference the caller supplied. This paragraph
 *     used to say it was "ONLY an id (a universal v7)", and {@link
 *     GOVERNS_RELATION} falsified that: a rule addressed at a path links a
 *     decision to `src/billing`, which is an id of nothing — and {@link
 *     ASKS_FOR_A_PERSON_RELATION} is the second label to do it, which turned
 *     "the exception" into "the shape". The narrow reading
 *     was already contradicted inside this product — the core classifies this
 *     field as PROSE, not as an identifier, on the ground that "each holds
 *     whatever a caller sent" — so what changed is this comment, not the shape.
 *     What the field never carries is a KIND beside the value: a `targetKind`
 *     would be redundant when the target IS an id and wrong when it is not, so
 *     the reader resolves what the target is by crossing projections and a
 *     target no projection knows is reported as unresolved. This is the same
 *     choice the supersede's `by` makes: the value alone, meaning by context.
 *   - `rel` is an OPEN literal string, not a closed enum — the same design as a
 *     transition's `action`. A recommended set is documented in {@link
 *     RECOMMENDED_LINK_RELATIONS}, but the parser accepts any non-empty string,
 *     so a new relation grows without an upcaster and a past link with an
 *     unfamiliar label is never rejected on read. That openness is what let
 *     `governs` be added without a field, a version or an upcaster.
 *
 * Unlike a supersede — which is same-tree by construction and refuses a dangling
 * `by` at write time — a link is legitimately CROSS-TREE (a private memory may
 * link to a public task) and the writer sees only its own tree, so a dangling
 * target is NOT refused. The link is an asserted fact; a target absent from the
 * current view is honest dangling, resolved on read against the union, exactly
 * as a partial clone's supersede is.
 */
export interface KnowledgeLinkedV1 extends Envelope {
  readonly kind: 'knowledge.linked';
  readonly v: 1;
  /** Subject is the entity that originates the link. */
  readonly payload: {
    /**
     * What the link points at: an id of another record, or — under {@link
     * GOVERNS_RELATION} and {@link ASKS_FOR_A_PERSON_RELATION} — a path in the
     * working tree. Whatever it is, it is the caller's string, never verified
     * here, and what it names is resolved on read.
     */
    readonly target: string;
    /** The relation label — an open literal string (see {@link RECOMMENDED_LINK_RELATIONS}). */
    readonly rel: string;
  };
}

/**
 * A relation whose target is a PATH and not an id: a rule of the record says which
 * part of the working tree it applies to.
 *
 * IT USED TO BE "THE ONE", and {@link ASKS_FOR_A_PERSON_RELATION} falsified that.
 * What the two share is the shape — subject a rule, target a path, compared by
 * segments by whoever reads them; what separates them is the POWER each carries,
 * which is why they are two labels and not one label read two ways.
 *
 * It is a label like any other — nothing in the parser knows it, nothing
 * validates the path, nothing refuses a link that uses it — and it exists as a
 * named constant for one reason: a reader that answers "which rules govern this
 * file" and a writer's help text that suggests the label must be the SAME
 * string, and a string typed twice is two strings that can come to differ. It is
 * the single site (see `RECOMMENDED_LINK_RELATIONS` below, which is built from
 * it, and the context package's governance reading, which imports it).
 *
 * Naming it here does not make the catalog aware of paths: `target` stays an
 * unverified caller's string, and a link under this label whose path names
 * nothing is exactly as valid, and as dangling, as one pointing at an id no tree
 * holds.
 */
export const GOVERNS_RELATION = 'governs';

/**
 * The relation that asks for a PERSON: a rule of the record says that under this part
 * of the working tree, nobody writes without somebody looking first.
 *
 * It is the same shape as {@link GOVERNS_RELATION} — subject is the rule, target is a
 * path — and it is a SECOND relation rather than a reading of the first, which is the
 * one decision in it worth the paragraph. Under the axis's first tie the rule that
 * charges is the record's and never the product's; if `governs` alone meant "ask a
 * person", then every rule anybody ever addressed would have become a gate on the day
 * the mechanism shipped, by an inference nobody recorded. So the gate is its own fact,
 * asserted on purpose, by a person, at an address they typed — and a charge cites that
 * fact's subject.
 *
 * IT IS SELF-SUFFICIENT, and does not require the rule to also `govern` the path.
 * Requiring two facts would make a gate that silently does not close when the second is
 * missing, which is the defect class the addressing reading already exists to make
 * visible. What it does require is that its subject be a rule IN FORCE — a superseded
 * decision cannot ask for anybody, and that is decided by the derivations that already
 * decide it rather than by a second rule here.
 *
 * Nothing in the parser knows this label either: `rel` is an open string, so this
 * relation cost the catalog no field, no version and no upcaster — exactly as `governs`
 * did.
 */
export const ASKS_FOR_A_PERSON_RELATION = 'asks-for-a-person';

/**
 * The relation that REFUSES a write: a rule of the record says that under this part of the
 * working tree, a file is not written at all while the rule stands.
 *
 * The same shape as {@link ASKS_FOR_A_PERSON_RELATION} — subject a rule, target a path — and
 * a THIRD relation rather than a grade carried on the second, which is the decision in it.
 * Asking and refusing are two powers over somebody else's work, and a link whose meaning
 * depended on a flag beside it would be a link whose power a reader could only learn by
 * reading the flag; a relation is the one place a power is already named in this record.
 * It is also why `asks-for-a-person` did not change: the gates that exist keep the meaning
 * they were asserted under.
 *
 * WHY IT EXISTS AT ALL, when asking already did: one of the hosts this product reaches lets
 * its agent write the file it was asked to hold (`measurements/hooks-by-host/`), so on that
 * host a person can only be protected by a refusal. And a refusal is the stronger power, so
 * where both relations address one path, refusing is what the write meets — decided once,
 * where the gate is decided.
 *
 * IT IS SELF-SUFFICIENT and needs its subject to be a rule IN FORCE, for the reasons the
 * asking relation gives: a refusal that required a second fact would silently not close
 * when the second is missing, and a retired rule refusing a write would be the product
 * stopping work on the authority of something the team set aside. Nothing in the parser
 * knows this label either, so it costs the catalog no field, no version and no upcaster.
 */
export const REFUSES_A_WRITE_RELATION = 'refuses-a-write';

/**
 * The relations whose target is an ADDRESS: a part of the working tree, compared by
 * segments, covering whatever lies under it.
 *
 * There are three, {@link GOVERNS_RELATION}, {@link ASKS_FOR_A_PERSON_RELATION} and
 * {@link REFUSES_A_WRITE_RELATION}, and naming them together is what lets a reader ask
 * "does this label carry an address" once instead of spelling out a list at every place
 * that has to know. Before this constant the pair was written out at each such site, and
 * the third address relation, when it came, joined here and was answered everywhere by
 * existing.
 *
 * IT USED TO SAY "THE RELATIONS WHOSE TARGET IS A PATH — THE WHOLE OF THEM", and the
 * decision import falsified that half of it: a proposal read out of somebody else's
 * decision file records its provenance as `derived-from` pointing at the FILE it came
 * out of, which is a path and is not on this list. Nothing about the shape changed —
 * `target` was always "whatever the caller sent" — so what was wrong was reading a
 * list about POWER as a list about shape. The distinction the two make is real and it
 * is not the slash between an id and a path: an address COVERS a region of the tree
 * and something has to walk it, while a provenance points at one file and nothing
 * walks anything. That is why the import needed no member here, and why a reader
 * asking "what does this cover" must ask this constant and not ask whether the target
 * looks like a path. The provenance is still not a member — and it is now
 * {@link DERIVED_FROM_RELATION}, a name of its own, because three parties spell it.
 *
 * It still says nothing about what each one DOES — one informs, one stops somebody until
 * a person looks, one refuses the write — because that is the power, and a reader of an
 * address needs the shape.
 */
export const ADDRESS_RELATIONS = [
  GOVERNS_RELATION,
  ASKS_FOR_A_PERSON_RELATION,
  REFUSES_A_WRITE_RELATION,
] as const;

/**
 * The recommended relation labels for a {@link KnowledgeLinkedV1}. This is a
 * documentation and grouping aid — NOT a closed set the parser enforces. A
 * projection may group by these known labels and pass any other through
 * verbatim; a `rel` outside this set is valid and never rejected, the same way a
 * new transition `action` is. Exported so a reader can group consistently
 * without hard-coding the strings.
 *
 * The two that take a PATH are spread from {@link ADDRESS_RELATIONS} rather than
 * listed again, so a third one cannot be recommended here and stay unknown to the
 * readers that ask what an address covers.
 */
export const DERIVED_FROM_RELATION = 'derived-from';

/**
 * The relation a PROVENANCE takes: the subject was derived from what the target names.
 *
 * It is the third label whose target is not an id — `mnema decision import` writes one
 * per proposal, pointing at the project-relative path of the document the decision was
 * read out of — and it is NOT a member of {@link ADDRESS_RELATIONS}, which is the one
 * distinction worth the paragraph. An address COVERS a subtree and something walks it;
 * a provenance names one file and nothing walks anything.
 *
 * IT IS A CONSTANT BECAUSE THE STRING WAS WRITTEN TWICE. `decision import` declared its
 * own `DERIVED_FROM_RELATION` in the command line's package while this set held the bare
 * literal, so the writer's label and the recommended vocabulary were two strings that
 * happened to agree. Now the reads want it too — `show`, `show --json` and `read_record`
 * carry a record's provenance — and a third spelling is how the write and the read come
 * to disagree about which edge is a provenance. One site, imported by all three.
 */
export const RECOMMENDED_LINK_RELATIONS = [
  'supersedes',
  'relates-to',
  DERIVED_FROM_RELATION,
  'contradicts',
  ...ADDRESS_RELATIONS,
] as const;

/**
 * A skill was created — the birth of a reusable pattern of work.
 *
 * A skill is a distilled way of working (a recipe, a checklist, a convention)
 * that a team curates: proposed, reviewed, then adopted as a live pattern or
 * rejected, and later deprecated when it falls out of use. Like a task and a
 * decision it is a WORKFLOW entity — multi-state, born through a birth pair — so
 * its creation carries only what identifies the pattern (`name`, `body`) and its
 * initial STATE is established by the birth `skill.transitioned`, never by this
 * event. There is no citable label like a decision's `adr`: a skill is named by
 * its id/alias, and where it came from (which rework suggested it) is derived
 * from the envelope's `run`, not a payload field.
 */
export interface SkillCreatedV1 extends Envelope {
  readonly kind: 'skill.created';
  readonly v: 1;
  /** Subject is the skill's id. */
  readonly payload: {
    /** A short title for the pattern. */
    readonly name: string;
    /** The pattern itself — the reusable instruction or description. */
    readonly body: string;
  };
}

/**
 * A skill moved between workflow states. Mirrors `task.transitioned` exactly —
 * `from`/`to`/`action` are literal strings and `fields` carries the textual
 * proof — and deliberately does NOT carry the `by` a decision's does. A skill is
 * not relational: one skill replacing another is a `knowledge.linked`
 * (`rel: "supersedes"`), the relational fact the catalog already proves, not a
 * field here. So a skill's move is the simpler of the two workflow transitions.
 *
 * `from` is `null` for exactly one transition: the birth that gives a skill its
 * initial state. The same rule as tasks and decisions — current state is the
 * `to` of the last transition, read without ever consulting the workflow.
 */
export interface SkillTransitionedV1 extends Envelope {
  readonly kind: 'skill.transitioned';
  readonly v: 1;
  /** Subject is the skill's id. */
  readonly payload: {
    /** The state left behind, or `null` when this is the birth transition. */
    readonly from: string | null;
    readonly to: string;
    readonly action: string;
    /** The transition's proof and context; omitted when it carries none. */
    readonly fields?: TransitionFields;
  };
}

/**
 * A skill was consulted — someone read the pattern, in this session.
 *
 * The fact answers "was this work informed by a pattern?", and it answers it
 * HONESTLY: consulted, not followed. Whether the pattern actually shaped the
 * work is not observable from serving its body, so the catalog records the only
 * half that is — that the body was asked for and handed over. Recording
 * "guided" would assert what nothing here proves; the same discipline that
 * keeps `ok` and `fullySigned` apart in the verifier rather than rounding up to
 * the stronger claim.
 *
 * Its subject is the SKILL, like a handoff's subject is the task: a consultation
 * has no standalone identity worth minting, it is an entry in the skill's own
 * history. Many consultations share one subject and do not collide — each is a
 * distinct event with its own chain link.
 *
 * The payload is EMPTY, and that is the whole shape rather than a stub. Every
 * part of the fact is already in the envelope the catalog carries for all
 * kinds: `subject` is which skill, `who` authorized, `which` agent read it, `run`
 * ties it to the session, `at` is when. A payload field would either duplicate
 * the envelope or invent data — the skill's name and state at the time are both
 * derivable from the record, and a derived copy can only drift from it.
 */
export interface SkillConsultedV1 extends Envelope {
  readonly kind: 'skill.consulted';
  readonly v: 1;
  /** Subject is the SKILL that was read. */
  readonly payload: Readonly<Record<string, never>>;
}

/**
 * A tail was authorized to be cut — the waiver that lets a reader tell an
 * authorized cut apart from a tail that went missing.
 *
 * WHAT IT IS FOR, MEASURED. Removing one line from the middle of a 402-event tail
 * produces 102 findings (a seq gap, a range mismatch, and 100 checkpoint chain
 * breaks in cascade); removing the first hundred events produces 454. Removing the
 * WHOLE tail produces none: the verifier reports `1 tail(s); no events yet` and
 * exits zero, which is the same sentence a tail that never wrote anything gets. So
 * the product punished the honest cut and could not see the dishonest one — and
 * the census note for the orphaned key already listed three readings of it
 * ("dropped by a botched merge, never written, or removed") with nothing on disk
 * to tell them apart. This event is that missing fact, and it answers the THIRD
 * reading only.
 *
 * IT IS PER TAIL, WHOLE, NEVER A RANGE. A waiver over an interval would oblige the
 * verifier to rejoin the checkpoint chain across the hole and to fall silent on
 * 100-151 cascading breaks plus 302 events left with no signature covering them —
 * the heart of how the proof is read. The founding document already said
 * "waiver assinado por-cauda"; the numbers above are why. And nobody needs a range
 * for SIZE: this product costs 884 B per event, 84.3 MiB per hundred thousand.
 *
 * IT IS WRITTEN BEFORE THE CUT, AND THAT IS WHAT MAKES IT CHECKABLE. While the tail
 * is still on disk, all three of its claims can be — and are — compared against it
 * at write time (see `unprovenWaiverReason`): the tail exists, its head hash is
 * `throughHash`, and it holds exactly `eventCount` events. Accepted afterwards, a
 * waiver would authorize anything retroactively and would be a signature over a
 * fact nobody could ever check. So this event is the AUTHORIZATION of a cut, not
 * the observation of one — the product itself never removes anything.
 *
 * IT LIVES IN THE AUTHORIZER'S TAIL, never in the one it names: the named tail is
 * about to stop existing, and a waiver inside it would go with it. The door refuses
 * a waiver that names the tail it is being appended to, so that cannot be got wrong
 * by accident.
 *
 * IT IS NOT ACCESS CONTROL AND IT IS NOT A CURE. Anyone who can write to the record
 * can declare a prune of any tail, exactly as anyone who can write can record any
 * other fact — the declaration is signed and attributed, so a forged waiver is a
 * fact that points at whoever forged it. And it says nothing about CONTENT: a tail
 * that is PRESENT and corrupt keeps every issue it had, because a waiver speaks of
 * an absence. `verify` treats it as a census note, never as a verdict: it moves
 * neither `ok` nor the exit code.
 *
 * WHAT IT DOES NOT PROMISE: forgetting. Once the record is pushed, reaching the
 * remote and every clone takes `git filter-repo`, a force push, and everyone
 * re-cloning — and a forbidden force-push is the precedent P1 itself cites. The
 * waiver makes a removal DISTINGUISHABLE from a tampering. It does not remove.
 */
export interface TailPrunedV1 extends Envelope {
  readonly kind: 'tail.pruned';
  readonly v: 1;
  /**
   * Subject is the ANCHOR the pruned tail spoke for — the identity whose tails are
   * the unit of the cut, taken from the `who` of that tail's last event.
   */
  readonly payload: {
    /** The tail id being cut: `<fingerprint>-<installationId>`. */
    readonly tail: string;
    /** The hash of that tail's last entry, as the disk held it when this was written. */
    readonly throughHash: string;
    /** How many events that tail held. A count, never a range: the cut is the whole tail. */
    readonly eventCount: number;
    /** Why it was cut — the proof of the why, as free text. */
    readonly reason: string;
  };
}

/**
 * A channel of this product was switched — someone turned OFF, or back ON, one of the
 * places mnema puts the record in front of a model without being asked.
 *
 * WHY IT IS A FACT OF THE CHAIN AND NOT A SETTING. The tie it exists for reads: every
 * charge is switchable, and the switching is recorded — switching off is legitimate,
 * switching off in SILENCE is not. A configuration file answers the first half and
 * defeats the second: nothing attributes it, nothing dates it, and a reader of the
 * record can never tell "no rule addressed that file" from "somebody had turned the
 * push off that week". As an event it inherits everything the catalog already gives
 * every fact — the authorizing `who`, the executing `which`, the `run`, the instant,
 * the signature and the link — and it inherits the SCOPE, so a switch that travels
 * with the repository and one kept on a single machine are the same fact filed in two
 * trees rather than two mechanisms.
 *
 * ITS SUBJECT IS THE CHANNEL, the way a consultation's subject is the skill: a switch
 * has no standalone identity worth minting, it is an entry in that channel's own
 * history. Many switches share one subject and do not collide.
 *
 * THE STATE IS A BOOLEAN AND NOT A LITERAL, which is the one place this kind departs
 * from the transitions. A transition's `to` is an open string so a workflow can grow
 * an action without touching this catalog; a switch has exactly two positions and a
 * third would not be a new label, it would be a different mechanism — so there is
 * nothing here for an open vocabulary to buy, and a boolean cannot be spelled two
 * ways ("off", "OFF", "false") by two producers.
 *
 * THE REASON IS OPTIONAL, and that is the tie read exactly. What it requires is the
 * FACT — who switched what, and when — never a justification: a product that refused
 * to let somebody turn it off without composing prose would be charging for the
 * switch, and the field would fill with a full stop. When a reason IS given it is the
 * most useful line an audit of this ever reads, which is why the field exists at all.
 *
 * NOTHING IS OFF WITHOUT ONE OF THESE. The absence of any `channel.switched` for a
 * channel is the channel being ON; there is no birth event and no default row. A
 * product that arrived switched off would be a product that looks installed and does
 * nothing.
 */
export interface ChannelSwitchedV1 extends Envelope {
  readonly kind: 'channel.switched';
  readonly v: 1;
  /** Subject is the CHANNEL that was switched. */
  readonly payload: {
    /** Its position after this fact: `true` is on, `false` is off. */
    readonly on: boolean;
    /** Why, when the person switching it said why. Never required. */
    readonly reason?: string;
  };
}

/**
 * A channel of this product SERVED the record in a run — the fact that the push was
 * actually pushing, as opposed to having been off, or broken, or never installed.
 *
 * WHY IT EXISTS: a push that records nothing leaves the product acting outside its own
 * record. Every other tie of the axis is paid by a fact; this one was not, and its
 * absence had a measured consequence — a rule that arrives silently and a channel that
 * never ran produce the identical nothing, so a later reader cannot tell "the rules
 * reached that session" from "the plugin was not installed that week". This is the
 * missing fact, and it is what gives a silence a name.
 *
 * IT COUNTS WHAT IS PUSHED AT AN EDIT, AND ONLY THAT. The channels that append it are the two
 * the per-edit hook carries — the rules addressed at a path, and the asking for a person —
 * because that is where something is pushed and something is written in the same act. The
 * two texts a session OPENS with are pushed too, and they are not counted: they are printed
 * by reads, and a read of this record writes nothing to it, on purpose. So "the channel was
 * live in that run" is a sentence about the edits of that run; a run with no such fact says
 * nothing about whether its opening texts arrived.
 *
 * IT IS ONCE PER RUN AND PER CHANNEL, never once per push, and the granularity is the
 * granularity of the POWER rather than of the mechanism. An injection is continuous
 * service, not a discrete act: the median session of this bench edits 34 files, the p90
 * edits 121 and the largest seen edited 3,424, and a signed append on each would put
 * thousands of writes on the hottest read path this product has to say the same sentence
 * over and over. What a reader needs is that the channel was live in that run, which one
 * fact carries exactly.
 *
 * ITS SUBJECT IS THE CHANNEL, the way {@link ChannelSwitchedV1}'s is, so a channel's own
 * history holds both what was done TO it and what it did. The payload is empty for the
 * same reason a consultation's is: everything the fact says — who, which agent, which
 * run, when — is envelope, and a payload field here would be a second spelling of
 * something already signed.
 */
export interface ChannelServedV1 extends Envelope {
  readonly kind: 'channel.served';
  readonly v: 1;
  /** Subject is the CHANNEL that served. */
  readonly payload: Readonly<Record<string, never>>;
}

/**
 * A channel of this product ASKED FOR A PERSON — the first fact in this catalog whose
 * subject did something to somebody else's work rather than describing it.
 *
 * WHAT IT RECORDS: a rule of the record asked that a file not be written until somebody
 * looked, the product carried that to the host, and the host stopped. It is one fact per
 * asking, and here the granularity of the power is discrete: an escalation is the
 * exercise of authority over ONE call, at one path, citing one rule, and a reader
 * auditing it needs each of them.
 *
 * IT CITES THE RULE, AND THE CITATION IS THE POINT. The axis's first tie says the
 * product has no opinion: it charges what a decision that was accepted or a pattern that
 * was adopted says, and it names the id. So `rule` is required. A charge that cannot name
 * what caused it is not a weaker charge, it is the product having a preference — and the
 * field being required is what keeps that from being a promise.
 *
 * ITS SUBJECT IS THE CHANNEL and not the rule, for the reason every other subject in this
 * catalog is what it is: the subject is the thing whose history the fact belongs to. A
 * rule's history is what was decided about it; the asking belongs to the surface that did
 * the asking, beside the switch that can silence it and the service that says it was
 * live. The rule travels in the payload, where the reference index resolves it exactly as
 * it resolves a link's target.
 *
 * A DIFFERENT GRADE IS A DIFFERENT KIND, not a field on this one. Refusing outright is a
 * different power over somebody else's work, and a payload that carried "which grade" would
 * be a payload whose meaning depends on a value — the shape this catalog avoids everywhere
 * else. This sentence said the refusal "waits on its own tie and will arrive as its own
 * fact"; it arrived, as {@link ChannelRefusedV1}, and this kind did not change.
 */
export interface ChannelAskedV1 extends Envelope {
  readonly kind: 'channel.asked';
  readonly v: 1;
  /** Subject is the CHANNEL that asked. */
  readonly payload: {
    /** The id of the rule that asked — what the charge cites. Never optional. */
    readonly rule: string;
    /** The path the asking was about, as the product compared it. */
    readonly path: string;
  };
}

/**
 * A channel of this product REFUSED A WRITE — the strongest thing it does to somebody
 * else's work: the file was not written, and no person was asked.
 *
 * WHAT IT RECORDS: a rule of the record, linked to a path under the relation that refuses a
 * write, was in force when a file under that path was about to be written; the product
 * carried the refusal to the host, and the host did not write it. One fact per refusal and
 * per rule, for the reason an asking is one per rule: a charge cites the rule that caused
 * it, and a fact whose citation was a set would half-cite the day one of them is
 * superseded.
 *
 * IT IS A KIND OF ITS OWN AND NOT A GRADE ON {@link ChannelAskedV1}, which said so before it
 * existed: a payload carrying "which grade" would be a payload whose meaning depends on a
 * value. So the two powers are two kinds with the same shape, and a reader auditing what
 * the record refused asks for this kind and nothing else. `channel.asked` is unchanged.
 *
 * ITS SUBJECT IS THE CHANNEL, and the rule travels in the payload, for the reasons the
 * asking gives: the refusal belongs to the surface that refused, beside the switch that can
 * silence it, and the reference index resolves the rule exactly as it resolves a link's
 * target. Both fields are required — a refusal that cannot name what caused it is the
 * product having a preference.
 */
export interface ChannelRefusedV1 extends Envelope {
  readonly kind: 'channel.refused';
  readonly v: 1;
  /** Subject is the CHANNEL that refused. */
  readonly payload: {
    /** The id of the rule that refused — what the refusal cites. Never optional. */
    readonly rule: string;
    /** The path the refusal was about, as the product compared it. */
    readonly path: string;
  };
}

/**
 * A RULE CARRIES A CHECK: a command that, run in the project at a commit, says whether the
 * rule held there.
 *
 * Its subject is the RULE — a decision's id — so the history of what checks a rule is read
 * under the rule's own id, as every other fact about it is. A later declaration on the same
 * rule replaces the earlier one for whoever runs the checks; neither is erased.
 *
 * THE COMMAND IS A PROGRAM AND ITS ARGUMENTS, never a line for a shell. `command` names the
 * program and `args` are handed to it one by one, so nothing in them is interpreted by
 * anybody on the way: a `;`, a `$(…)` or a `|` is an argument like any other. What a check
 * needs a shell for, it says by naming the shell as its program — which is then a choice
 * the record shows, not one the runner made for it.
 *
 * Declaring a check is a person's act, and an ordinary one: it is signed and authorized
 * like every other fact. Running it is not — see {@link CheckPassedV1}.
 */
export interface CheckDeclaredV1 extends Envelope {
  readonly kind: 'check.declared';
  readonly v: 1;
  /** Subject is the rule — the id of the decision the check is for. */
  readonly payload: {
    /** The program to run. */
    readonly command: string;
    /** Its arguments, one by one. Absent when it takes none. */
    readonly args?: readonly string[];
  };
}

/**
 * A KEY WAS ENROLLED AS A CHECKER: a key that signs the results of checks, and nothing else.
 *
 * It is how a machine — a CI runner, whose key is a secret of the repository — comes to sign
 * facts in a record whose every other fact a person authorized. It does NOT join anybody's
 * identity: a checker speaks for itself, under the anchor its own key derives (`subject`),
 * so an account of who authorized what says a machine ran the check, not the person who
 * let it.
 *
 * `who` is the person who vouches for it and `signerFp` a key valid for that person's anchor
 * at this point, exactly as a {@link KeyEnrolledV1}'s voucher. `reverseSig` is the checker
 * key's own consent, over `check-enroll:<who>:<checkerFp>` — a message of its own, so a
 * request a key made to JOIN an identity cannot be turned into a checker enrolment, and one
 * made to check cannot be turned into a membership.
 *
 * THE ROLE IS THE WHOLE POINT, and the reader enforces it both ways: a `check.passed` or a
 * `check.failed` is authentic only when signed by a key enrolled as a checker, and ANY other
 * kind signed by such a key is refused. A leaked runner secret can therefore say a check
 * passed; it cannot record a decision, enrol a key or found an identity.
 */
export interface CheckerEnrolledV1 extends Envelope {
  readonly kind: 'checker.enrolled';
  readonly v: 1;
  /** Subject is the checker's own anchor, derived from `checkerFp`. */
  readonly payload: {
    /** The full fingerprint of the key enrolled as a checker. */
    readonly checkerFp: string;
    /** `checkerFp`'s hex Ed25519 signature over `check-enroll:<who>:<checkerFp>`. */
    readonly reverseSig: string;
  };
}

/**
 * A CHECKER KEY WAS RETIRED: from this point the key is no checker, and it never signs again.
 *
 * The answer to a leaked runner secret. `who` is an identity, and `signerFp` a key valid for
 * it at this point — the same as a {@link CheckerEnrolledV1}'s voucher, and any identity may
 * retire as any identity may enrol. The key's consent is not asked: a leaked key is the case
 * this is for. `subject` is the checker's own anchor, derived from `checkerFp`, as at its
 * enrolment, and `reason` says why.
 *
 * What the reader does with it (FORMAT.md section 6.2), when it is itself signature-covered:
 * a `check.passed` or `check.failed` the key signs after it is refused, any other kind it
 * signs stays refused, and a later `checker.enrolled` naming it is refused — a retired key
 * does not come back; a new key does. A result it signed BEFORE stays authentic, because the
 * key held the role when it signed; and `verify` names every such result in its census,
 * because "before" is placed by the `at` the key itself wrote, which a leaked key chooses.
 */
export interface CheckerRetiredV1 extends Envelope {
  readonly kind: 'checker.retired';
  readonly v: 1;
  /** Subject is the checker's own anchor, derived from `checkerFp`. */
  readonly payload: {
    /** The full fingerprint of the checker key being retired. */
    readonly checkerFp: string;
    /** Why it is being retired — the proof of the why. */
    readonly reason: string;
  };
}

/**
 * A RULE'S CHECK PASSED at one commit: the command declared for it ran there and exited 0.
 *
 * Signed by a key enrolled as a checker (see {@link CheckerEnrolledV1}), under that key's own
 * anchor — `who` is the machine, never a person. Its subject is the rule, and `commit` the
 * commit the working tree stood at when the command ran, so the fact says "this rule held
 * HERE", not "this rule holds".
 *
 * `command` and `args` are what was run, copied from the declaration in force, so the fact
 * says what it proves without a reader having to find which declaration stood at the time.
 * `output` is the tail of what the command printed, bounded and with every control byte
 * made visible, or absent when it printed nothing.
 */
export interface CheckPassedV1 extends Envelope {
  readonly kind: 'check.passed';
  readonly v: 1;
  /** Subject is the rule the check is for. */
  readonly payload: {
    /** The commit the check ran at — the full object name. */
    readonly commit: string;
    /** The program that ran. */
    readonly command: string;
    /** Its arguments, one by one. Absent when it took none. */
    readonly args?: readonly string[];
    /** The tail of what it printed, bounded and neutralized. Absent when it printed nothing. */
    readonly output?: string;
  };
}

/**
 * A RULE'S CHECK FAILED at one commit — the mirror of {@link CheckPassedV1}, with `failure`
 * saying how: the exit code, the timeout, or why the program could not be started.
 */
export interface CheckFailedV1 extends Envelope {
  readonly kind: 'check.failed';
  readonly v: 1;
  /** Subject is the rule the check is for. */
  readonly payload: {
    /** The commit the check ran at — the full object name. */
    readonly commit: string;
    /** The program that ran, or was meant to. */
    readonly command: string;
    /** Its arguments, one by one. Absent when it took none. */
    readonly args?: readonly string[];
    /** How it failed: an exit code, a timeout, a program that could not start. */
    readonly failure: string;
    /** The tail of what it printed, bounded and neutralized. Absent when it printed nothing. */
    readonly output?: string;
  };
}

/**
 * An identity named an account it holds on a code host — today, `github`.
 *
 * WHAT IT IS: a CLAIM, signed by a key of the identity it names, and nothing more. It
 * proves that a member key of that identity said "my account there is this one"; it does
 * not prove the host agrees. Whether it does is a separate reading, asked for explicitly
 * and made against the host at the time of the reading — the account's published keys
 * compared with the keys the identity signed with. The record holds the name, never the
 * answer, because the answer is the host's and changes when the account changes its keys.
 *
 * Subject is the anchor, and `who == subject`: an identity names its own account, never
 * another's. A reader honours only that shape. It is outside the enrolment fold — it adds
 * and removes no key — so a reader of the format authenticates it by the rule every other
 * event is authenticated by, and nothing else. A later one for the same service replaces
 * an earlier one, in the order the record is merged in.
 */
export interface AccountLinkedV1 extends Envelope {
  readonly kind: 'account.linked';
  readonly v: 1;
  /** Subject is the anchor that names the account. */
  readonly payload: {
    /** Which host the account is on. `github` is the one this product writes and reads. */
    readonly service: string;
    /** The account's name on that host. */
    readonly account: string;
  };
}

/**
 * The catalog: every event the chain may contain. `kind` + `v` together select
 * exactly one arm, so a producer and a consumer can never disagree on a
 * payload shape without the compiler saying so.
 */
export type CatalogEvent =
  | RunStartedV1
  | RunEndedV1
  | TaskCreatedV1
  | TaskTransitionedV1
  | DecisionRecordedV1
  | DecisionTransitionedV1
  | IdentityFoundedV1
  | KeyEnrolledV1
  | KeyRevokedV1
  | MemoryCapturedV1
  | ObservationRecordedV1
  | HandoffRecordedV1
  | KnowledgeLinkedV1
  | SkillCreatedV1
  | SkillTransitionedV1
  | SkillConsultedV1
  | TailPrunedV1
  | ChannelSwitchedV1
  | ChannelServedV1
  | ChannelAskedV1
  | ChannelRefusedV1
  | NoteRetractedV1
  | CheckDeclaredV1
  | CheckerEnrolledV1
  | CheckPassedV1
  | CheckFailedV1
  | CheckerRetiredV1
  | AccountLinkedV1
  | BackupDeclaredV1;

/** The `kind` discriminators present in the catalog. */
export type EventKind = CatalogEvent['kind'];

/**
 * The latest version of each kind. A producer always writes the latest; older
 * versions only ever arrive from the chain and are lifted forward by upcasters.
 */
export const LATEST_VERSION: { readonly [K in EventKind]: number } = {
  'run.started': 1,
  'run.ended': 1,
  'task.created': 1,
  'task.transitioned': 1,
  'decision.recorded': 1,
  'decision.transitioned': 1,
  'identity.founded': 1,
  'key.enrolled': 1,
  'key.revoked': 1,
  'memory.captured': 1,
  'observation.recorded': 1,
  'handoff.recorded': 1,
  'knowledge.linked': 1,
  'skill.created': 1,
  'skill.transitioned': 1,
  'skill.consulted': 1,
  'tail.pruned': 1,
  'channel.switched': 1,
  'channel.served': 1,
  'channel.asked': 1,
  'channel.refused': 1,
  'note.retracted': 1,
  'check.declared': 1,
  'checker.enrolled': 1,
  'check.passed': 1,
  'check.failed': 1,
  'checker.retired': 1,
  'account.linked': 1,
  'backup.declared': 1,
};
