/**
 * @mnema/chain — the proof engine.
 *
 * This package is the tamper-evidence core: the typed event catalog, the
 * per-tail hash chain, Ed25519 checkpoints over a content-recomputable root,
 * and the verifier. It has zero runtime dependencies so the surface that
 * carries the proof stays small, isolated, and auditable on its own.
 *
 * The catalog, chain, and verifier land in following changes; this entry
 * point currently exports only the package identity.
 */

export const PACKAGE_NAME = '@mnema/chain';
