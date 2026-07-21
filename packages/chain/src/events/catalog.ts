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
  };
}

/**
 * The catalog: every event the chain may contain. `kind` + `v` together select
 * exactly one arm, so a producer and a consumer can never disagree on a
 * payload shape without the compiler saying so.
 */
export type CatalogEvent = RunStartedV1 | RunEndedV1 | TaskCreatedV1 | TaskTransitionedV1;

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
};
