import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The per-MACHINE identifier that names this machine's audit tail
 * (`audit/m-<prefix>/`). Deliberately NOT the per-actor Ed25519
 * fingerprint: the tail must exist from the very first write, even
 * before an identity is configured, and one actor working from two
 * machines must still land on two distinct tails.
 *
 * Minted once per machine into the user-level dir (the same
 * machine-scoped home as the project secret), 128 bits of randomness —
 * collision-free across any real fleet by construction.
 */
const MACHINE_ID_FILE = 'machine-id';

/** Directory-name prefix for a machine tail under the audit dir. */
export const TAIL_DIR_PREFIX = 'm-';

/** Matches a machine-tail directory name (`m-` + 12 hex). */
export const TAIL_DIR_PATTERN = /^m-[0-9a-f]{12}$/;

/**
 * Reads the machine id, minting and persisting it on first use.
 *
 * @param userDir - The user-level dir (`~/.config/mnema` in production;
 *   tests pass an isolated path)
 * @returns 32 lowercase hex chars, stable for this machine
 */
export function getOrCreateMachineId(userDir: string): string {
  const file = path.join(userDir, MACHINE_ID_FILE);
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf-8').trim().toLowerCase();
    if (/^[0-9a-f]{32}$/.test(existing)) return existing;
  }
  const minted = randomBytes(16).toString('hex');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(file, `${minted}\n`, { encoding: 'utf-8', mode: 0o600 });
  return minted;
}

/**
 * The tail-directory name for a machine id (`m-` + first 12 hex).
 *
 * @param machineId - Full 32-hex machine id
 * @returns Directory name under the audit dir
 */
export function tailDirName(machineId: string): string {
  return `${TAIL_DIR_PREFIX}${machineId.slice(0, 12)}`;
}

/**
 * Absolute path to THIS machine's audit tail (`<auditDir>/m-<id>/`), minting
 * the machine id on first use. The single place that composes
 * {@link getOrCreateMachineId} + {@link tailDirName} + the audit dir — the
 * local mutators (write, reconcile, prune, reattest) and the mirror-scoped
 * count checks all resolve their tail through here instead of repeating the
 * three-call incantation.
 *
 * @param auditDir - The project audit dir (`.mnema/audit`)
 * @param userDir - The machine-scoped user dir holding `machine-id` (the same
 *   dir the project secret and machine key use; callers pass `userKnowledgeDir()`)
 * @returns Absolute path to this machine's tail directory
 */
export function localTailDir(auditDir: string, userDir: string): string {
  return path.join(auditDir, tailDirName(getOrCreateMachineId(userDir)));
}
