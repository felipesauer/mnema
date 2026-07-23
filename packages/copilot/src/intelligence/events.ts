/**
 * The event type the intelligence derivations read — the SAME cataloged event
 * the chain proves, named here without ever importing the chain.
 *
 * The intelligence layer is unlike the rest of the copilot: it does not read the
 * ProjectionCache (the current STATE), it reads the raw event stream. timeline,
 * accountability and antipatterns are all about the SEQUENCE of facts — who
 * authorized what, in what order, how often a thing recurred — and the
 * projections deliberately drop the envelope's `who` (a task projection keeps no
 * author). So these three read what `orderedEvents` returns: the raw, ordered,
 * deterministic stream of cataloged events, each carrying its full envelope
 * (`who`/`which`/`at`/`kind`/`subject`) and its typed payload.
 *
 * The type is DERIVED from `orderedEvents`' return, not imported by name: the
 * copilot's boundary forbids naming the chain package directly (where the
 * cataloged-event union lives), and the core does not re-export that type by
 * name. Deriving it from the one read function the core DOES export gives the
 * exact discriminated union — every arm, every payload — with no new dependency
 * and no widening. Narrowing on `kind` still reaches each arm's payload (an
 * `observation.recorded`'s `about`, a `knowledge.linked`'s `target`) exactly as
 * if the union were imported directly.
 */

import type { orderedEvents } from '@mnema/core';

/**
 * One cataloged event as the chain proves it — the element type of the ordered
 * stream. A `readonly CatalogEvent[]` is the single input every intelligence
 * derivation takes; the caller decides the scope (one tree via `orderedEvents`,
 * the union of trees via `orderedEventsAcross`), and the derivation stays pure
 * over the stream it is handed — the same "the scope is the caller's" discipline
 * the context layer applies to the actor.
 */
export type CatalogEvent = ReturnType<typeof orderedEvents>[number];

/** The `kind` discriminator of a cataloged event. */
export type EventKind = CatalogEvent['kind'];
