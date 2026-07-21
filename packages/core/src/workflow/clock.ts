/**
 * A uniform timestamp for events the core emits.
 *
 * Every event stamps `at`. The projection uses `at` only to interleave events
 * ACROSS tails (never within one — that order is proven by seq), so what matters
 * is that all producers write the SAME format: same precision, same zone. A mix
 * of formats would make the cross-tail interleaving read wrong even though the
 * chain stays intact. So the core mints `at` in exactly one shape —
 * `Date.prototype.toISOString`: UTC, millisecond precision, trailing `Z` —
 * rather than letting each call site choose.
 *
 * A `Clock` is injectable so a caller (a test, a deterministic replay) can pin
 * the time; the default reads the wall clock.
 */

/** Produces the current instant as a uniform ISO-8601 UTC timestamp. */
export type Clock = () => string;

/** The default clock: the wall clock in uniform ISO-8601 UTC. */
export const systemClock: Clock = () => new Date().toISOString();
