/**
 * The catalog's upcaster registry: the single place that wires every
 * version-lift the current catalog knows.
 *
 * Today the catalog has only v1 of each kind, so the registry is empty and a
 * v1 event reaches the latest in zero steps. When a kind gains a v2, its
 * `(kind, 1) → 2` upcaster is registered HERE, next to the catalog it serves,
 * so the reader always has a complete ladder.
 */

import { UpcasterRegistry } from './upcaster.js';

/** Builds the registry wired with all upcasters the current catalog needs. */
export function catalogUpcasters(): UpcasterRegistry {
  return new UpcasterRegistry();
  // Register version lifts here as the catalog grows, e.g.:
  //   .register({ kind: 'task.transitioned', from: 1 }, liftTaskTransitionedV1toV2);
}
