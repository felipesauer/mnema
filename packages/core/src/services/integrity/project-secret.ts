import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { userKnowledgeDir } from '../knowledge/user-knowledge.js';

/** Length of a per-project HMAC secret, in bytes. */
const SECRET_BYTES = 32;

/**
 * Label prefixing an export envelope. Versioned so a future format change is
 * detectable; the project key follows it so an import into the wrong project
 * is rejected rather than silently installed.
 */
const ENVELOPE_PREFIX = 'mnema-hmac-secret/v1';

/**
 * Where the committed, NON-SECRET fingerprint of the project secret lives,
 * relative to the project root. A clone reads this to learn which secret
 * it should hold (ADR-37); it never contains the secret itself.
 */
export const HMAC_ID_RELATIVE = path.join('.mnema', 'keys', 'project.hmac-id');

/**
 * Reads the committed project HMAC fingerprint straight from the repo, with no
 * project key or user dir needed — the anonymous-verify view of it. The
 * fingerprint lives at a fixed committed path under the project root, so a
 * clone with no secret still reads exactly the value it should bind an
 * attestation's `projectHmacId` to. Returns `null` when it was never committed.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/`)
 * @returns The committed `sha256(secret)` hex, or `null` when absent
 */
export function readCommittedProjectHmacId(projectRoot: string): string | null {
  const file = path.join(projectRoot, HMAC_ID_RELATIVE);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf-8').trim();
}

/**
 * Manages the per-project HMAC secret that keys the audit chain's sealed
 * events (shareable as a team credential).
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
   * @param userDir - The user-level dir (`~/.config/mnema`); injectable so
   *   tests point at an isolated path and never touch the real home. Must
   *   be the SAME value the container's other user-level services use
   *   (`options.userDir ?? userKnowledgeDir()`), or the writer and the
   *   verifier would resolve different secrets.
   */
  constructor(
    private readonly projectRoot: string,
    private readonly projectKey: string,
    private readonly userDir: string = userKnowledgeDir(),
  ) {}

  /** Absolute path to the raw secret file (outside the repo). */
  secretPath(): string {
    return path.join(this.userDir, 'projects', this.projectKey, 'hmac.key');
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
   *   clobber the committed fingerprint. Writes are mandatory-keyed, so the
   *   caller refuses to seal (rather than degrading) until the secret is
   *   imported;
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

  /**
   * Serializes the current secret into a labelled, single-line envelope for
   * out-of-band transmission to a teammate (ADR-39: the HMAC secret is a
   * shareable team credential). The envelope embeds the project key so an
   * import into the wrong project is caught, not silently installed.
   *
   * Read-only: it NEVER mints a secret. A machine with no local secret
   * cannot export one — that would either invent a competing secret (on a
   * clone) or surprise the caller by writing state under an "export".
   *
   * @returns The envelope `mnema-hmac-secret/v1:<projectKey>:<base64>`
   * @throws If no secret is present on this machine
   */
  exportEnvelope(): string {
    const secret = this.read();
    if (secret === null) {
      throw new Error(
        `no project secret on this machine for "${this.projectKey}" — ` +
          `nothing to export (it is minted on the first audit write of a new project, ` +
          `or imported from a teammate on a clone)`,
      );
    }
    return `${ENVELOPE_PREFIX}:${this.projectKey}:${secret.toString('base64')}`;
  }

  /**
   * Parses and validates an export envelope for THIS project. Checks the
   * label, the embedded project key (catches a paste into the wrong
   * project), the base64 payload, and the 32-byte length.
   *
   * @param envelope - A string produced by {@link exportEnvelope}
   * @returns The decoded 32-byte secret
   * @throws With a specific message on any structural or project-key mismatch
   */
  parseEnvelope(envelope: string): Buffer {
    const trimmed = envelope.trim();
    if (!trimmed.startsWith(`${ENVELOPE_PREFIX}:`)) {
      throw new Error(
        `not a mnema HMAC secret envelope (expected it to start with "${ENVELOPE_PREFIX}:")`,
      );
    }
    // Split into exactly 3 fields: prefix, project key, payload. The base64
    // payload has no ':' so a plain split is unambiguous.
    const parts = trimmed.split(':');
    if (parts.length !== 3) {
      throw new Error('malformed HMAC secret envelope (expected prefix:project:payload)');
    }
    const [, envKey, payload] = parts;
    if (envKey !== this.projectKey) {
      throw new Error(
        `envelope is for project "${envKey}", but this project is "${this.projectKey}" — refusing to import`,
      );
    }
    let secret: Buffer;
    try {
      secret = Buffer.from(payload ?? '', 'base64');
    } catch {
      throw new Error('HMAC secret envelope payload is not valid base64');
    }
    // base64 decoding is lenient (it silently drops junk), so validate the
    // decoded length rather than trust the decode. A short/long blob is a
    // corrupted paste, not a usable secret.
    if (secret.length !== SECRET_BYTES) {
      throw new Error(
        `HMAC secret must be ${SECRET_BYTES} bytes, got ${secret.length} — the blob is corrupted or truncated`,
      );
    }
    return secret;
  }

  /**
   * Installs an imported secret at {@link secretPath} (0600). Refuses when
   * the secret contradicts the committed fingerprint (installing it would
   * fork the chain under the wrong key), and refuses to overwrite an
   * existing local secret unless `force` is set.
   *
   * @param secret - The 32-byte secret (already length-validated)
   * @param options.force - Overwrite an existing local secret
   * @throws On a fingerprint mismatch, or an existing secret without `force`
   */
  install(secret: Buffer, options: { force?: boolean } = {}): void {
    const committed = this.readFingerprint();
    if (committed !== null && ProjectSecretService.fingerprint(secret) !== committed) {
      throw new Error(
        `imported secret does not match the project's committed fingerprint ` +
          `(${HMAC_ID_RELATIVE}) — it is for a different project or corrupted`,
      );
    }
    if (this.read() !== null && options.force !== true) {
      throw new Error(
        `a project secret already exists on this machine — pass --force to overwrite it`,
      );
    }
    this.writeSecretAtomic(secret);
    // Self-heal a missing committed fingerprint (a clone importing before the
    // fingerprint was ever committed): record it now so downgrade detection
    // works. When it already exists we verified it matches above.
    if (committed === null) this.writeFingerprint(secret);
  }

  /** Reads the committed fingerprint, or `null` when absent. */
  readFingerprint(): string | null {
    return readCommittedProjectHmacId(this.projectRoot);
  }

  private writeSecretAtomic(secret: Buffer): void {
    const file = this.secretPath();
    mkdirSync(path.dirname(file), { recursive: true });
    // Randomized tmp name + `wx` (O_CREAT|O_EXCL): the exclusive create fails
    // rather than following a symlink pre-planted at a predictable path, so
    // the secret can never be written through an attacker-controlled link on
    // a shared host. Created 0600 atomically; chmod is belt-and-braces.
    const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(tmp, secret, { mode: 0o600, flag: 'wx' });
    try {
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (error) {
      // A failure after the tmp was created (chmod/rename) would orphan it —
      // remove it so no stray secret file lingers.
      if (existsSync(tmp)) unlinkSync(tmp);
      throw error;
    }
  }

  private writeFingerprint(secret: Buffer): void {
    const file = this.fingerprintPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${ProjectSecretService.fingerprint(secret)}\n`, 'utf-8');
  }
}
