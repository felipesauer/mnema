/**
 * @mnema/chain — the proof engine.
 *
 * This package is the tamper-evidence core: the typed event catalog, the
 * per-tail hash chain, Ed25519 checkpoints over a content-recomputable root,
 * and the verifier. It has zero runtime dependencies so the surface that
 * carries the proof stays small, isolated, and auditable on its own.
 *
 * This entry point exports the event core. The chain writer, checkpoints, and
 * verifier land in following changes.
 */

export const PACKAGE_NAME = '@mnema/chain';

export {
  runEnded,
  runStarted,
  taskCreated,
  taskTransitioned,
} from './events/build.js';
export {
  CanonicalizationError,
  type CanonicalValue,
  canonicalBytes,
  canonicalStringify,
} from './events/canonical.js';
export {
  type CatalogEvent,
  type EventKind,
  LATEST_VERSION,
  type RunEndedV1,
  type RunStartedV1,
  type TaskCreatedV1,
  type TaskTransitionedV1,
} from './events/catalog.js';
export type { Envelope, Which, Who } from './events/envelope.js';
export { EventParseError, parseEvent, toCanonical } from './events/parse.js';
export { catalogUpcasters } from './events/registry.js';
export {
  type LatestVersions,
  type Upcaster,
  UpcasterError,
  UpcasterRegistry,
  type VersionedEvent,
} from './events/upcaster.js';
