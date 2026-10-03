/**
 * The one shape every entity fold has, so the batch fold of a replay and the step a cache
 * takes over what ARRIVED are the same code and not two readings of a rule.
 *
 * A projection of an entity (a task, a run, a decision, a skill) is a fold over the events
 * that name it, and between events it holds an ACCUMULATOR that is not yet a projection:
 * a task whose `task.created` has not been seen has no title, and is not projected until it
 * has all it needs (see each fold's `finish`). That in-between state is what a cache that
 * persists its tables has to persist too — a transition that arrives before the birth it
 * belongs to (two tails, one entity) finds an accumulator, not a row. The step is therefore
 * the whole of the rule, and everything that differs between a replay and an advance is
 * where the accumulator comes from:
 *
 *   - a replay starts every accumulator empty and keeps them in a map ({@link accumulate});
 *   - an advance loads the accumulator the cache stored for the entity, steps it, and
 *     stores it back (`advance.ts`).
 *
 * The equality of the two is asserted over one event of every kind in the catalog
 * (`advance.test.ts`), not assumed from this file.
 */

import type { CatalogEvent } from '@mnema/chain';

/** One entity fold: how an event moves an accumulator, and what a finished one projects to. */
export interface AccumulatorFold<A, P> {
  /** The name its accumulators are stored under. */
  readonly name: string;
  /** A fresh accumulator, for an entity no event has named yet. */
  create(): A;
  /**
   * Applies one event. `of(id)` hands back the accumulator of ANY entity the event
   * touches — a supersede touches two — creating it when the entity is new.
   */
  step(of: (id: string) => A, event: CatalogEvent): void;
  /** The projection an accumulator amounts to, or undefined while the entity is incomplete. */
  finish(id: string, acc: A): P | undefined;
  /** The accumulator as it is stored. */
  encode(acc: A): string;
  /** The accumulator back from what {@link encode} stored. */
  decode(stored: string): A;
}

/** What a fold of a whole stream leaves: the accumulators, and the projections they finish to. */
export interface Accumulated<A, P> {
  readonly accumulators: Map<string, A>;
  readonly projections: Map<string, P>;
}

/** Folds a whole ordered stream — the replay's way, every accumulator starting empty. */
export function accumulate<A, P>(
  fold: AccumulatorFold<A, P>,
  events: readonly CatalogEvent[],
): Accumulated<A, P> {
  const accumulators = new Map<string, A>();
  const of = (id: string): A => {
    let acc = accumulators.get(id);
    if (acc === undefined) {
      acc = fold.create();
      accumulators.set(id, acc);
    }
    return acc;
  };
  for (const event of events) fold.step(of, event);
  const projections = new Map<string, P>();
  for (const [id, acc] of accumulators) {
    const projected = fold.finish(id, acc);
    if (projected !== undefined) projections.set(id, projected);
  }
  return { accumulators, projections };
}

/** The encoding of an accumulator that is plain JSON — every fold's but the run's. */
export function jsonEncoding<A>(): {
  encode(acc: A): string;
  decode(stored: string): A;
} {
  return {
    encode: (acc) => JSON.stringify(acc),
    decode: (stored) => JSON.parse(stored) as A,
  };
}
