/**
 * Persisting and loading a machine's key pair and its installation id.
 *
 * The private key is written locally and never committed; the public key is
 * written next to it, named by fingerprint, and IS committed so verifiers can
 * find it. Opening a chain to write generates a fresh pair on first use — a
 * reinstalled machine simply gets a new identity, and past checkpoints stay
 * verifiable against their (still committed) public keys.
 *
 * The installation id is a random value minted once per installation and, like
 * the private key, kept local and never committed. It is what separates two
 * installations that share ONE copied key: each mints its own id, so their tail
 * directories differ and neither overwrites the other on a merge, while both
 * still authorize as the one anchor the shared key derives.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  generateKeyPair,
  type KeyPair,
  privateKeyFromPem,
  privateKeyToPem,
  publicKeyFromPem,
  publicKeyToPem,
} from './keys.js';
import {
  anchorPath,
  type ChainLayout,
  installationIdPath,
  keysDir,
  privateKeyPath,
  publicKeyPath,
} from './layout.js';

/**
 * Loads this machine's key pair, generating and persisting one if none exists.
 * A machine is identified by having BOTH a private and a public key on disk; if
 * only the public keys of OTHER machines are present, a new pair is minted.
 */
export function loadOrCreateKeyPair(layout: ChainLayout): KeyPair {
  const existing = findLocalKeyPair(layout);
  if (existing !== null) return existing;

  const keyPair = generateKeyPair();
  persistKeyPair(layout, keyPair);
  return keyPair;
}

/** Finds a local key pair (a public key whose matching private key is present). */
function findLocalKeyPair(layout: ChainLayout): KeyPair | null {
  const dir = keysDir(layout);
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.key')) continue;
    const fingerprint = name.slice(0, -'.key'.length);
    const pubPath = publicKeyPath(layout, fingerprint);
    if (!existsSync(pubPath)) continue;
    const privateKey = privateKeyFromPem(
      readFileSync(privateKeyPath(layout, fingerprint), 'utf-8'),
    );
    const publicKey = publicKeyFromPem(readFileSync(pubPath, 'utf-8'));
    return { privateKey, publicKey, fingerprint };
  }
  return null;
}

/** Writes both halves of a key pair to disk. */
export function persistKeyPair(layout: ChainLayout, keyPair: KeyPair): void {
  mkdirSync(keysDir(layout), { recursive: true });
  writeFileSync(publicKeyPath(layout, keyPair.fingerprint), publicKeyToPem(keyPair.publicKey), {
    encoding: 'utf-8',
  });
  writeFileSync(privateKeyPath(layout, keyPair.fingerprint), privateKeyToPem(keyPair.privateKey), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/**
 * Loads this installation's id for the given key, minting and persisting one on
 * first use. The id is 16 random bytes as hex — no dashes, so it never disturbs
 * the single `<fingerprint>-<installationId>` split, and wide enough that two
 * installations of the same copied key never collide.
 *
 * It is keyed by fingerprint but the FILE is local and uncommitted, so a machine
 * that receives a copied private key finds no `.inst` beside it and mints its
 * own — the mechanism that keeps the two on separate tails.
 */
export function loadOrCreateInstallationId(layout: ChainLayout, fingerprint: string): string {
  const path = installationIdPath(layout, fingerprint);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf-8').trim();
    if (existing.length > 0) return existing;
  }
  const installationId = randomBytes(16).toString('hex');
  mkdirSync(keysDir(layout), { recursive: true });
  writeFileSync(path, `${installationId}\n`, { encoding: 'utf-8', mode: 0o600 });
  return installationId;
}

/**
 * Reads the anchor this key serves, or null when none is recorded yet. Local
 * and uncommitted, like the installation id: it says WHICH anchor this
 * installation authorizes as. A machine with no recorded anchor founds its own
 * on first use.
 */
export function readAnchor(layout: ChainLayout, fingerprint: string): string | null {
  const path = anchorPath(layout, fingerprint);
  if (!existsSync(path)) return null;
  const value = readFileSync(path, 'utf-8').trim();
  return value.length > 0 ? value : null;
}

/**
 * Records the anchor this key serves — the anchor it founded (its own) or one it
 * enrolled into. Written once and never committed; a second write with the same
 * value is a harmless no-op, a write with a different value would change which
 * identity this installation speaks for and is the caller's decision to make.
 */
export function writeAnchor(layout: ChainLayout, fingerprint: string, anchor: string): void {
  mkdirSync(keysDir(layout), { recursive: true });
  writeFileSync(anchorPath(layout, fingerprint), `${anchor}\n`, { encoding: 'utf-8', mode: 0o600 });
}
