/**
 * The event catalog: the closed, typed set of facts the chain can contain.
 *
 * The catalog is the single source of what a valid event looks like. It is a
 * discriminated union keyed by `kind`, each arm pinning its payload contract
 * and its version. Nothing outside this union may be appended — a fact the
 * catalog does not describe is not a fact the chain promises to prove.
 *
 * Adding a kind is a deliberate design change (a new thing we promise to
 * prove), not an arbitrary runtime shape. Changing a published payload is
 * never an in-place edit: it is a new version plus an upcaster, so an event
 * written under an old contract stays readable and reproducible forever.
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
  | KeyRevokedV1;

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
};
