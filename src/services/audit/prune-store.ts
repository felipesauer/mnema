import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type PruneWaiver, parsePruneWaiver, serializePruneWaiver } from './prune-waiver.js';

/**
 * File (relative to the audit dir) holding the committed prune waiver — the
 * signed record that the chain was deliberately re-baselined by a retention
 * prune. Committed like the audit log itself; its digest is the surviving
 * genesis's `prev_hash` anchor. One waiver at a time: a subsequent prune
 * overwrites it, because the walk only ever re-baselines the CURRENT genesis
 * and a superseded waiver would name a genesis no longer on disk (and so would
 * be rejected by verify anyway).
 */
const PRUNE_WAIVER_FILE = 'prune-accepted.json';

/** Absolute path to the committed prune waiver for an audit dir. */
export function pruneWaiverPath(auditDir: string): string {
  return path.join(auditDir, PRUNE_WAIVER_FILE);
}

/**
 * Reads the committed prune waiver, or `null` when absent or malformed (a
 * malformed file is treated as no waiver — never a crash, never an accidental
 * accept). Reading it does NOT confirm it applies: the caller must verify the
 * signature, the project pin, and that the on-disk genesis matches, via
 * {@link verifyPruneWaiver}.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The waiver, or `null`
 */
export function readPruneWaiver(auditDir: string): PruneWaiver | null {
  const file = pruneWaiverPath(auditDir);
  if (!existsSync(file)) return null;
  try {
    return parsePruneWaiver(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Writes the committed prune waiver. Called ONLY by the prune apply step after
 * it has built and signed the waiver over the verified dropped prefix — this
 * function performs no verification.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param waiver - The signed waiver to persist
 */
export function writePruneWaiver(auditDir: string, waiver: PruneWaiver): void {
  writeFileSync(pruneWaiverPath(auditDir), serializePruneWaiver(waiver), 'utf-8');
}

/**
 * Removes the committed prune waiver, if present. Used when a fresh prune
 * supersedes an older one and no cut survives (nothing to re-baseline), so a
 * stale waiver is never left pointing at a vanished genesis.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 */
export function removePruneWaiver(auditDir: string): void {
  rmSync(pruneWaiverPath(auditDir), { force: true });
}
