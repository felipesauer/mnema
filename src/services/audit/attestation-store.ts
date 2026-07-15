import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MachineKeyService } from '../integrity/machine-key.js';
import {
  type AttestationArtifact,
  parseArtifact,
  serializeArtifact,
} from './attestation-artifact.js';

/** Subdirectory of the audit dir holding committed `.att` artifacts. */
const ATTEST_SUBDIR = 'attest';

/** Directory (relative to the project root) holding committed `.pub` keys. */
const KEYS_SUBDIR = path.join('.mnema', 'keys');

/** Absolute path to the attestation directory for an audit dir. */
export function attestDir(auditDir: string): string {
  return path.join(auditDir, ATTEST_SUBDIR);
}

/** Absolute path to the `.att` file for a batch ending at `to`. */
export function attestPath(auditDir: string, to: number): string {
  return path.join(attestDir(auditDir), `${to}.att`);
}

/**
 * Reads every committed `.att` under `<auditDir>/attest/`, in ascending `to`
 * order. A file that fails to parse is SKIPPED (never throws): a single
 * corrupt artifact must not blind the verifier to the valid ones, and a
 * verdict of "malformed" belongs to the verify layer, not the loader.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The parsed artifacts, ascending by `to`
 */
export function listArtifacts(auditDir: string): AttestationArtifact[] {
  const dir = attestDir(auditDir);
  if (!existsSync(dir)) return [];
  const artifacts: AttestationArtifact[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.att')) continue;
    try {
      artifacts.push(parseArtifact(readFileSync(path.join(dir, name), 'utf-8')));
    } catch {
      // Skip a malformed/partial .att; the verify layer reports coverage gaps.
    }
  }
  return artifacts.sort((a, b) => a.to - b.to);
}

/** Reads the artifact for a specific `to`, or `null` when absent/malformed. */
export function readArtifact(auditDir: string, to: number): AttestationArtifact | null {
  const file = attestPath(auditDir, to);
  if (!existsSync(file)) return null;
  try {
    return parseArtifact(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Writes an artifact to `<auditDir>/attest/<to>.att` as committed JSON.
 * Deterministic by `to`: two machines closing the same batch produce identical
 * bytes, so a concurrent write is a benign overwrite rather than a conflict.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param artifact - The artifact to persist
 */
export function writeArtifact(auditDir: string, artifact: AttestationArtifact): void {
  const dir = attestDir(auditDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(attestPath(auditDir, artifact.to), serializeArtifact(artifact), 'utf-8');
}

/**
 * Builds the set of TRUSTED signer public keys from the committed `.pub`
 * records under `.mnema/keys/`, keyed by FULL fingerprint. This is the trust
 * anchor for anonymous verification (ADR-41): the committed `.pub` set IS the
 * allowlist, and resolution is by the 256-bit fingerprint — never the 12-char
 * filename prefix — so a record whose declared fingerprint does not match the
 * key it contains simply never resolves.
 *
 * `parsePublicKey` already re-derives the fingerprint from the key bytes and
 * rejects a record whose stored fingerprint disagrees, so a tampered `.pub`
 * (key swapped, fingerprint kept) is dropped here rather than trusted. A
 * malformed file is skipped, never a crash.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @returns A resolver from full fingerprint to public-key PEM (or `null`)
 */
export function committedSignerResolver(
  projectRoot: string,
): (fingerprint: string) => string | null {
  const dir = path.join(projectRoot, KEYS_SUBDIR);
  const byFingerprint = new Map<string, string>();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.pub')) continue;
      try {
        const record = MachineKeyService.parsePublicKey(
          readFileSync(path.join(dir, name), 'utf-8'),
        );
        // Key by the re-derived (verified) fingerprint, so the map can only be
        // resolved by a fingerprint that genuinely owns the key.
        byFingerprint.set(record.fingerprint, record.publicKey);
      } catch {
        // Skip a malformed/tampered .pub; it simply is not a trusted signer.
      }
    }
  }
  return (fingerprint: string) => byFingerprint.get(fingerprint) ?? null;
}
