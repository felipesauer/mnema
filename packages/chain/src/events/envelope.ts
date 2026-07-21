/**
 * The event envelope: the proof fields every cataloged event carries,
 * independent of its kind.
 *
 * An event is the primary proof — autonomous and complete. It records who
 * authorized the fact, which agent carried it out, in which run, when, and
 * the primary entity it moved. The kind-specific detail (and any related
 * entity ids) lives in the typed payload, not here.
 *
 * The chain-link fields (previous-hash, tail id, hash) are NOT part of the
 * envelope: they are stamped by the chain writer when the event is appended,
 * and they belong to the chain, not to the fact. The envelope plus payload is
 * exactly the content that canonicalizes and that a checkpoint signs.
 */

/** Identity of the human who authorized a fact. Never an agent. */
export type Who = string;

/** Identity of the agent that carried out a fact, when one did. */
export type Which = string;

/**
 * The proof envelope shared by every event kind.
 *
 * `who` and `which` are distinct roles by construction: the human
 * authorizes, the agent executes. An action taken inside a run inherits the
 * run's authorization; the writer is responsible for populating `who` from the
 * run that authorized it. A missing `who` is an invalid event, enforced where
 * events are gated — the envelope only carries the field.
 */
export interface Envelope {
  /** Version of the event's kind-specific contract (see the catalog). */
  readonly v: number;
  /** Discriminator selecting the payload contract. */
  readonly kind: string;
  /** ISO-8601 timestamp of when the fact happened. */
  readonly at: string;
  /** The human who authorized the fact. */
  readonly who: Who;
  /** The agent that carried it out, when applicable. */
  readonly which?: Which;
  /** The run this fact belongs to, when applicable. */
  readonly run?: string;
  /** Id of the primary entity this fact moves. */
  readonly subject: string;
}
