import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { userKnowledgeDir } from './user-knowledge.js';

/** Length of a per-project HMAC secret, in bytes. */
const SECRET_BYTES = 32;

/**
 * Where the committed, NON-SECRET fingerprint of the project secret lives,
 * relative to the project root. A clone reads this to learn which secret
 * it should hold (ADR-37); it never contains the secret itself.
 */
export const HMAC_ID_RELATIVE = path.join('.mnema', 'keys', 'project.hmac-id');

/**
 * Manages the per-project HMAC secret that keys the audit chain's v3
 * events (ADR-37 layer 2; shareable as a team credential per ADR-39).
 *
 * The raw secret lives OUTSIDE the repo at
 * `~/.config/mnema/projects/<key>/hmac.key` (0600) — out of the agent's
 * in-repo write reach — and is never committed. Only a non-secret
 * fingerprint (`sha256(secret)` hex) is written into the repo at
 * {@link HMAC_ID_RELATIVE}, so any clone knows which secret it should
 * have without the secret leaking through version control.
 *
 * Mirrors the storage discipline of `hook-trust` (fingerprint under the
 * user dir) and `identity-service` (atomic tmp→chmod→rename write).
 */
export class ProjectSecretService {
  /**
   * @param projectRoot - Absolute project root (holds `.mnema/`)
   * @param projectKey - Project key; names the per-project secret dir
   * @param home - Home-dir resolver; injectable for tests
   */
  constructor(
    private readonly projectRoot: string,
    private readonly projectKey: string,
    private readonly home: () => string = homedir,
  ) {}

  /** Absolute path to the raw secret file (outside the repo). */
  secretPath(): string {
    return path.join(userKnowledgeDir(this.home), 'projects', this.projectKey, 'hmac.key');
  }

  /** Absolute path to the committed, non-secret fingerprint file. */
  fingerprintPath(): string {
    return path.join(this.projectRoot, HMAC_ID_RELATIVE);
  }

  /**
   * Returns the project secret, generating it ONLY for a brand-new project
   * (no committed fingerprint and no local secret). The three cases:
   *
   * - local secret present → return it (self-heal a missing fingerprint);
   * - committed fingerprint present but NO local secret → this is a clone
   *   that has not imported the secret. Return `null` — do NOT invent a
   *   new secret, which would fork the chain under a second key and
   *   clobber the committed fingerprint. The caller writes v2 (degraded)
   *   until the secret is imported (MNEMA-170);
   * - neither present → a genuinely new project: generate + persist both.
   *
   * @returns The 32-byte secret, or `null` when it exists but is not on
   *   this machine (clone-without-import)
   */
  getOrCreate(): Buffer | null {
    const existing = this.read();
    if (existing !== null) {
      if (!existsSync(this.fingerprintPath())) this.writeFingerprint(existing);
      return existing;
    }
    // A committed fingerprint with no local secret ⇒ clone-without-import.
    // Never generate a competing secret here.
    if (this.readFingerprint() !== null) return null;

    const secret = randomBytes(SECRET_BYTES);
    this.writeSecretAtomic(secret);
    this.writeFingerprint(secret);
    // Re-read: under a concurrent first-write, the rename that won is the
    // canonical secret — return that, not necessarily the bytes we generated,
    // so the returned secret always matches the persisted file + fingerprint.
    return this.read() ?? secret;
  }

  /** Reads the secret if present, else `null`. */
  read(): Buffer | null {
    const file = this.secretPath();
    if (!existsSync(file)) return null;
    return readFileSync(file);
  }

  /** The non-secret fingerprint of a secret: `sha256(secret)` hex. */
  static fingerprint(secret: Buffer): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Reads the committed fingerprint, or `null` when absent. */
  readFingerprint(): string | null {
    const file = this.fingerprintPath();
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf-8').trim();
  }

  private writeSecretAtomic(secret: Buffer): void {
    const file = this.secretPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, secret, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  }

  private writeFingerprint(secret: Buffer): void {
    const file = this.fingerprintPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${ProjectSecretService.fingerprint(secret)}\n`, 'utf-8');
  }
}
