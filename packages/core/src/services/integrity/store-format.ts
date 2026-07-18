import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_VERSION } from '../../config/config-schema.js';
import { WORKFLOW_SCHEMA_VERSION } from '../../domain/state-machine/workflow-meta-schema.js';
import { EVENT_FORMAT_VERSION } from '../../storage/audit/audit-hash.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { migrationsDir } from '../../utils/asset-paths.js';
import { MIRROR_LAYOUT_VERSION } from '../../utils/mirror-layout.js';
import { ATTEST_VERSION } from '../audit/attestation-artifact.js';

/** The committed store-format marker, a single-line sha256 hex under keys/. */
export const STORE_FORMAT_RELATIVE = path.join('.mnema', 'keys', 'store-format');

/**
 * The format inputs whose combination the marker pins. Each is a fact about
 * how THIS binary reads and writes the store — never per-row content. A change
 * to any one is a store-format change: it re-hashes, and a machine on the old
 * marker refuses to mutate until `mnema migrate` reconciles.
 */
export interface StoreFormatInputs {
  /** Highest migration id the BINARY ships (disk listing, not the DB). */
  readonly migration: number;
  /** The single keyed audit event format. */
  readonly event: number;
  /** The content-attestation scheme tag. */
  readonly attest: string;
  /** The markdown mirror layout tag. */
  readonly mirror: string;
  /** The active workflow's schema version. */
  readonly workflow: string;
  /** The config-shape version. */
  readonly config: string;
}

/**
 * Reads this binary's format inputs. `migrationsDirOverride` lets a test point
 * at a synthetic migrations dir to prove a bumped input changes the hash.
 */
export function readStoreFormatInputs(migrationsDirOverride?: string): StoreFormatInputs {
  const dir = migrationsDirOverride ?? migrationsDir();
  const versions = new MigrationRunner().listAvailable(dir).map((m) => m.version);
  return {
    migration: versions.length > 0 ? Math.max(...versions) : 0,
    event: EVENT_FORMAT_VERSION,
    attest: ATTEST_VERSION,
    mirror: MIRROR_LAYOUT_VERSION,
    workflow: WORKFLOW_SCHEMA_VERSION,
    config: CONFIG_VERSION,
  };
}

/**
 * The deterministic hash of a format-input set. Keys are emitted in a fixed
 * order so the digest never depends on object insertion order, mirroring the
 * `canonicalise`→sha256 recipe the audit layer uses.
 */
export function computeStoreFormatHash(inputs: StoreFormatInputs): string {
  const canonical = JSON.stringify({
    attest: inputs.attest,
    config: inputs.config,
    event: inputs.event,
    migration: inputs.migration,
    mirror: inputs.mirror,
    workflow: inputs.workflow,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Absolute path to the marker for a project. */
export function storeFormatPath(projectRoot: string): string {
  return path.join(projectRoot, STORE_FORMAT_RELATIVE);
}

/** A valid marker is exactly one line of 64 lowercase hex (a sha256 digest). */
const MARKER_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Reads the committed marker hex, or `null` when absent OR unreadable — an
 * absent marker is a pre-feature project, and a marker that is empty or not a
 * clean sha256 (a botched merge, a conflict marker, a truncated write) is
 * treated the SAME: fail-OPEN, never a mutation lockout. A store-format
 * MISMATCH is only ever reported against a well-formed marker that names a
 * different format — never against corruption, which `mnema migrate` rewrites.
 */
export function readStoreFormatMarker(projectRoot: string): string | null {
  const file = storeFormatPath(projectRoot);
  if (!existsSync(file)) return null;
  const value = readFileSync(file, 'utf-8').trim();
  return MARKER_PATTERN.test(value) ? value : null;
}

/**
 * Writes (or overwrites) the marker with THIS binary's format hash. Only the
 * store owners call this — `init`, and the reconcile paths (`migrate`,
 * `upgrade`) that bring a store to this format. An ordinary mutation never
 * does, or the guard would forever agree with itself and never fire.
 */
export function writeStoreFormatMarker(projectRoot: string, migrationsDirOverride?: string): void {
  const file = storeFormatPath(projectRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const hash = computeStoreFormatHash(readStoreFormatInputs(migrationsDirOverride));
  writeFileSync(file, `${hash}\n`, 'utf-8');
}

/** The verdict of {@link checkStoreFormat}. */
export interface StoreFormatCheck {
  /** True when a MUTATION may proceed (marker absent, or hash matches). */
  readonly ok: boolean;
  /**
   * When not ok, the format inputs of THIS binary, `name=value`. The marker is
   * a single opaque hash, so the exact input that moved cannot be isolated from
   * it; the caller names this candidate set so the operator sees what to
   * compare. Empty when ok.
   */
  readonly diverged: readonly string[];
}

/**
 * Compares this binary's format hash against the committed marker. READS never
 * call this; it gates MUTATIONS. Fail-open when the marker is absent (a
 * pre-feature store). When present and mismatched, reports not-ok with the
 * input names so the caller can name the divergence.
 */
export function checkStoreFormat(
  projectRoot: string,
  migrationsDirOverride?: string,
): StoreFormatCheck {
  const marker = readStoreFormatMarker(projectRoot);
  if (marker === null) return { ok: true, diverged: [] };
  const inputs = readStoreFormatInputs(migrationsDirOverride);
  const here = computeStoreFormatHash(inputs);
  if (here === marker) return { ok: true, diverged: [] };
  // The marker is one opaque hash, so we cannot tell WHICH input moved from it
  // alone; name them all so the operator sees the candidate set.
  return {
    ok: false,
    diverged: [
      `migration=${inputs.migration}`,
      `event=${inputs.event}`,
      `attest=${inputs.attest}`,
      `mirror=${inputs.mirror}`,
      `workflow=${inputs.workflow}`,
      `config=${inputs.config}`,
    ],
  };
}
