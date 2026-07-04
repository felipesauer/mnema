import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { userKnowledgeDir } from './user-knowledge.js';

/** Format marker for the committed public-key record. */
const PUBLIC_KEY_VERSION = '1.0';

/**
 * Chars of the key fingerprint used to disambiguate the committed public
 * key's filename. Two machines that share one actor mint distinct keys, so
 * distinct fingerprints keep their `.pub` files from colliding.
 */
const FINGERPRINT_SHORT_LEN = 12;

/**
 * The handle grammar the identity service persists (kept in sync with
 * `identity-service`'s private `HANDLE_PATTERN`). A handle is already
 * path-safe by construction; this is re-checked here so a bad handle fails
 * loudly at construction rather than producing a path-hostile filename.
 * `:` is excluded, so an `agent:`-prefixed handle is rejected — machine
 * keys attest the human actor that advances the head, not agents.
 */
const ACTOR_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * The committed, non-secret public-key record. A clone reads this to verify
 * a head signature; it never contains private key material.
 */
export interface PublicKeyRecord {
  readonly version: string;
  readonly actor: string;
  readonly algorithm: 'ed25519';
  /** SPKI PEM — fed straight back to `createPublicKey` for verification. */
  readonly publicKey: string;
  /** `sha256(SPKI DER)` hex — stable across PEM whitespace. */
  readonly fingerprint: string;
  readonly createdAt: string;
}

/** A resolved machine keypair plus the fingerprint that names its `.pub`. */
export interface MachineKeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly fingerprint: string;
}

/**
 * Manages the per-machine Ed25519 keypair that signs the periodic audit
 * chain head (ADR-37 layer 2 machine attestation). The keypair is bound to
 * the resolved actor: the SAME handle stamped on events also owns the key.
 *
 * The PRIVATE key lives OUTSIDE the repo at
 * `~/.config/mnema/keys/<actor>.ed25519` (0600) and NEVER leaves the
 * machine. The PUBLIC key is written into the repo at
 * `.mnema/keys/<actor>.<fp12>.pub` so any clone can verify signatures.
 *
 * It mirrors {@link ProjectSecretService}'s storage discipline (injectable
 * `userDir`, atomic tmp→chmod 0600→rename, a committed repo-relative
 * artifact) but is ASYMMETRIC, which changes two things:
 *
 * - there is no clone-without-key `null` branch — a machine that holds no
 *   private key is simply a DIFFERENT machine and mints its own keypair;
 * - the committed filename carries the key fingerprint, so two machines
 *   sharing one actor never clobber each other's public key.
 *
 * The actor handle is injected (the caller resolves it via the identity
 * service), keeping this primitive free of the actor repository.
 */
export class MachineKeyService {
  /** Lazily-loaded local keypair, so repeated signs don't re-read disk. */
  private cached: MachineKeyPair | null = null;

  /**
   * @param projectRoot - Absolute project root (holds `.mnema/`)
   * @param actor - Resolved human actor handle; owns the keypair
   * @param userDir - The user-level dir (`~/.config/mnema`); injectable so
   *   tests point at an isolated path. Must be the SAME value the
   *   container's other user-level services use, or the signer and verifier
   *   would resolve different keys.
   * @param now - Clock, injectable for deterministic `createdAt` in tests
   * @throws If `actor` is not a valid, path-safe handle
   */
  constructor(
    private readonly projectRoot: string,
    private readonly actor: string,
    private readonly userDir: string = userKnowledgeDir(),
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!ACTOR_PATTERN.test(actor) || actor === '.' || actor === '..') {
      throw new Error(`invalid actor handle for a machine key: \`${actor}\``);
    }
  }

  /** Absolute path to this machine's private key (outside the repo). */
  privateKeyPath(): string {
    return path.join(this.userDir, 'keys', `${this.actor}.ed25519`);
  }

  /** Absolute path to the committed public-key record for a fingerprint. */
  publicKeyPathFor(fingerprint: string): string {
    const short = fingerprint.slice(0, FINGERPRINT_SHORT_LEN);
    return path.join(this.projectRoot, '.mnema', 'keys', `${this.actor}.${short}.pub`);
  }

  /**
   * Absolute path to THIS machine's committed public-key record. Requires a
   * local keypair (the fingerprint names the file).
   *
   * @throws If no private key exists on this machine yet
   */
  publicKeyPath(): string {
    return this.publicKeyPathFor(this.getOrCreate().fingerprint);
  }

  /** The fingerprint of an SPKI DER public key: `sha256(der)` hex. */
  static fingerprint(publicKeyDer: Buffer): string {
    return createHash('sha256').update(publicKeyDer).digest('hex');
  }

  /**
   * Returns this machine's keypair, generating it once if absent. An
   * existing private key is NEVER overwritten. Unlike
   * {@link ProjectSecretService.getOrCreate} this never returns `null`: a
   * machine with no private key mints its own (a committed `.pub` for the
   * actor only means ANOTHER machine already has a key).
   *
   * @returns The keypair and its public fingerprint
   */
  getOrCreate(): MachineKeyPair {
    if (this.cached !== null) return this.cached;

    const existing = this.read();
    if (existing !== null) {
      // Self-heal a missing committed public key without touching the key.
      if (!existsSync(this.publicKeyPathFor(existing.fingerprint))) {
        this.writePublicKeyRecord(existing.publicKey, existing.fingerprint);
      }
      this.cached = existing;
      return existing;
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const fingerprint = MachineKeyService.fingerprint(spkiDer(publicKey));
    this.writePrivateKeyAtomic(privateKey);
    this.writePublicKeyRecord(publicKey, fingerprint);
    // Re-read: under a concurrent first-write the rename that won is the
    // canonical key, so return that — the returned pair always matches the
    // persisted file.
    const resolved = this.read() ?? { privateKey, publicKey, fingerprint };
    this.cached = resolved;
    return resolved;
  }

  /**
   * Signs `message` with this machine's private key (Ed25519). Requires the
   * keypair to exist — call {@link getOrCreate} first; signing does not
   * silently mint+commit a key as a side effect.
   *
   * @param message - Bytes to sign (e.g. the head hash)
   * @returns The Ed25519 signature
   */
  sign(message: Buffer): Buffer {
    return edSign(null, message, this.getOrCreate().privateKey);
  }

  /**
   * Verifies an Ed25519 signature against a committed public key (PEM).
   * Static: a verifier has only the committed `.pub`, no local machine.
   *
   * @returns True iff the signature is valid; false (not a throw) for a
   *   well-formed but wrong signature
   */
  static verify(message: Buffer, signature: Buffer, publicKeyPem: string): boolean {
    return edVerify(null, message, createPublicKey(publicKeyPem), signature);
  }

  /**
   * Reads THIS machine's committed public-key record, or `null` when the
   * machine has no keypair yet.
   */
  readPublicKey(): PublicKeyRecord | null {
    const local = this.read();
    if (local === null) return null;
    const file = this.publicKeyPathFor(local.fingerprint);
    if (!existsSync(file)) return null;
    return MachineKeyService.parsePublicKey(readFileSync(file, 'utf-8'));
  }

  /**
   * Parses and validates any committed `.pub` record. Re-derives the
   * fingerprint from the embedded key and rejects a record whose stored
   * fingerprint disagrees — a hand-edited `.pub` (key swapped, fingerprint
   * kept) must not verify.
   *
   * @throws If the record is malformed or its fingerprint is inconsistent
   */
  static parsePublicKey(json: string): PublicKeyRecord {
    const raw = JSON.parse(json) as Partial<PublicKeyRecord>;
    if (raw.algorithm !== 'ed25519' || typeof raw.publicKey !== 'string') {
      throw new Error('malformed public-key record');
    }
    const der = spkiDer(createPublicKey(raw.publicKey));
    const derived = MachineKeyService.fingerprint(der);
    if (raw.fingerprint !== derived) {
      throw new Error('public-key record fingerprint does not match its key');
    }
    return {
      version: raw.version ?? PUBLIC_KEY_VERSION,
      actor: raw.actor ?? '',
      algorithm: 'ed25519',
      publicKey: raw.publicKey,
      fingerprint: derived,
      createdAt: raw.createdAt ?? '',
    };
  }

  /** Loads the local keypair from disk, or `null` when absent. */
  private read(): MachineKeyPair | null {
    const file = this.privateKeyPath();
    if (!existsSync(file)) return null;
    const privateKey = createPrivateKey(readFileSync(file, 'utf-8'));
    // Derive the public key from the private one. Round-tripping through the
    // private key's PEM sidesteps an overload-resolution quirk where a bare
    // KeyObject is mistaken for raw key bytes.
    const publicKey = createPublicKey(
      privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    );
    const fingerprint = MachineKeyService.fingerprint(spkiDer(publicKey));
    return { privateKey, publicKey, fingerprint };
  }

  private writePrivateKeyAtomic(privateKey: KeyObject): void {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const file = this.privateKeyPath();
    mkdirSync(path.dirname(file), { recursive: true });
    // Randomized tmp + `wx` (O_EXCL): exclusive create fails rather than
    // following a symlink pre-planted at a predictable path, so the private
    // key is never written through an attacker-controlled link.
    const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(tmp, pem, { mode: 0o600, flag: 'wx' });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  }

  private writePublicKeyRecord(publicKey: KeyObject | string, fingerprint: string): void {
    const pem =
      typeof publicKey === 'string'
        ? publicKey
        : (publicKey.export({ type: 'spki', format: 'pem' }) as string);
    const record: PublicKeyRecord = {
      version: PUBLIC_KEY_VERSION,
      actor: this.actor,
      algorithm: 'ed25519',
      publicKey: pem,
      fingerprint,
      createdAt: this.now().toISOString(),
    };
    const file = this.publicKeyPathFor(fingerprint);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  }
}

/** SPKI DER bytes of a public key — the canonical form the fingerprint uses. */
function spkiDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
}
