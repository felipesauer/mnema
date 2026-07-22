/**
 * The event envelope: the proof fields every cataloged event carries,
 * independent of its kind.
 *
 * An event is the primary proof — autonomous and complete. It records who
 * authorized the fact, which agent carried it out, in which run, when, which
 * physical key signed it, and the primary entity it moved. The kind-specific
 * detail (and any related entity ids) lives in the typed payload, not here.
 *
 * Identity is three fields of different natures, never conflated:
 *   - `who` — the human who AUTHORIZED the fact. Not a typed-in name: an ANCHOR
 *     id derived from the local key (`mnid:<hash>`), so it is unique by
 *     construction and cannot be forged by choosing a string. A caller does not
 *     supply it; the writing operation derives it from its key.
 *   - `signerFp` — the full fingerprint of the physical key that SIGNED the
 *     event. Which machine attested it. The same key that signs the checkpoint,
 *     bound here too, so a signature cannot be re-pointed at another key. With
 *     one machine and one key `who` is just `sha256(signerFp)` — expected, not
 *     redundant: the two diverge only once several keys share one anchor (a
 *     later concern), and carrying both from the first event is what makes that
 *     possible without ever changing the event's shape.
 *   - `which` — the agent that EXECUTED the fact, when one did. A free name
 *     (e.g. `claude`), never a key: an agent has no key of its own; the machine
 *     signs on its behalf. `who` and `which` are distinct identities by
 *     construction — an anchor hash never collides with an agent name.
 *
 * The chain-link fields (previous-hash, tail id, hash) are NOT part of the
 * envelope: they are stamped by the chain writer when the event is appended,
 * and they belong to the chain, not to the fact. The envelope plus payload is
 * exactly the content that canonicalizes and that a checkpoint signs.
 */

/** Identity of the human who authorized a fact: an anchor id (`mnid:<hash>`). */
export type Who = string;

/** Identity of the agent that carried out a fact, when one did: a free name. */
export type Which = string;

/**
 * The proof envelope shared by every event kind.
 *
 * `who` and `which` are distinct roles by construction: the human (an anchor)
 * authorizes, the agent (a name) executes. An action taken inside a run
 * inherits the run's authorization; the writer derives `who` and `signerFp`
 * from its own key. A missing `who` is an invalid event, enforced where events
 * are gated — the envelope only carries the field.
 */
export interface Envelope {
  /** Version of the event's kind-specific contract (see the catalog). */
  readonly v: number;
  /** Discriminator selecting the payload contract. */
  readonly kind: string;
  /** ISO-8601 timestamp of when the fact happened. */
  readonly at: string;
  /** The human who authorized the fact — an anchor id derived from a key. */
  readonly who: Who;
  /** The full fingerprint of the key that signed this event. */
  readonly signerFp: string;
  /** The agent that carried it out, when applicable. */
  readonly which?: Which;
  /** The run this fact belongs to, when applicable. */
  readonly run?: string;
  /** Id of the primary entity this fact moves. */
  readonly subject: string;
}
