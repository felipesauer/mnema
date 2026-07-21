/**
 * Persisting and loading a machine's key pair.
 *
 * The private key is written locally and never committed; the public key is
 * written next to it, named by fingerprint, and IS committed so verifiers can
 * find it. Opening a chain to write generates a fresh pair on first use — a
 * reinstalled machine simply gets a new identity, and past checkpoints stay
 * verifiable against their (still committed) public keys.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  generateKeyPair,
  type KeyPair,
  privateKeyFromPem,
  privateKeyToPem,
  publicKeyFromPem,
  publicKeyToPem,
} from './keys.js';
import { type ChainLayout, keysDir, privateKeyPath, publicKeyPath } from './layout.js';

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
