import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  parseRebaselineWaiver,
  type RebaselineWaiver,
  serializeRebaselineWaiver,
} from './rebaseline-waiver.js';

/**
 * File (relative to a machine tail dir) holding the committed re-baseline
 * waiver — the signed record that this tail's genesis or head was deliberately
 * moved (a retention prune, or an accepted truncation). Committed like the
 * audit log itself. ONE waiver per tail at a time: a subsequent re-baseline
 * overwrites it, because the walk only ever re-baselines the CURRENT baseline
 * head and a superseded waiver would name a head no longer on disk (rejected by
 * verify anyway).
 */
const REBASELINE_WAIVER_FILE = 'rebaseline.json';

/** Absolute path to the committed re-baseline waiver for a tail dir. */
export function rebaselineWaiverPath(tailDir: string): string {
  return path.join(tailDir, REBASELINE_WAIVER_FILE);
}

/**
 * Reads the committed re-baseline waiver for a tail, or `null` when absent or
 * malformed (a malformed file is treated as no waiver — never a crash, never an
 * accidental accept). Reading it does NOT confirm it applies: the caller must
 * verify the signature, the project pin, the tail pin, and that the on-disk
 * head matches, via {@link verifyRebaselineWaiver}.
 *
 * @param tailDir - Absolute path to a machine tail (`audit/m-<id>/`)
 * @returns The waiver, or `null`
 */
export function readRebaselineWaiver(tailDir: string): RebaselineWaiver | null {
  const file = rebaselineWaiverPath(tailDir);
  if (!existsSync(file)) return null;
  try {
    return parseRebaselineWaiver(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Writes the committed re-baseline waiver for a tail. Called only by the
 * recovery paths (prune apply, accept-truncation) after building and signing
 * the waiver — this function performs no verification.
 *
 * @param tailDir - Absolute path to a machine tail (`audit/m-<id>/`)
 * @param waiver - The signed waiver to persist
 */
export function writeRebaselineWaiver(tailDir: string, waiver: RebaselineWaiver): void {
  writeFileSync(rebaselineWaiverPath(tailDir), serializeRebaselineWaiver(waiver), 'utf-8');
}

/**
 * Removes the committed re-baseline waiver for a tail, if present. Used when a
 * fresh prune supersedes an older one and no cut survives, so a stale waiver is
 * never left pointing at a vanished head.
 *
 * @param tailDir - Absolute path to a machine tail (`audit/m-<id>/`)
 */
export function removeRebaselineWaiver(tailDir: string): void {
  rmSync(rebaselineWaiverPath(tailDir), { force: true });
}
