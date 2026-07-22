/**
 * Persisting and loading a person's key pair, materializing its public half into
 * a chain, and minting a chain's installation id.
 *
 * The key belongs to the PERSON and lives in ONE place — a key root, separate
 * from any chain — so a single identity can write to several chains (a project's
 * public tree, its private one, a global one) without copying the private key.
 * The key root holds the full pair; a chain never does. A chain instead gets the
 * public half MATERIALIZED into it ({@link materializePublicKey}), named by
 * fingerprint and committed, so a verifier — a collaborator, an anonymous clone
 * — finds the key it needs without ever touching the key root.
 *
 * The private key is written under the key root and never committed. Generating
 * a fresh pair on first use means a reinstalled machine simply gets a new
 * identity, and past checkpoints stay verifiable against their (still committed)
 * public keys.
 *
 * The installation id is a random value minted once PER CHAIN and, like the
 * private key, kept local and never committed. It is what separates one person's
 * several chains (and two installations that share ONE copied key): each chain
 * mints its own id, so their tail directories differ and none overwrites another
 * on a merge, while all still authorize as the one anchor the key derives.
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

/** Writes both halves of a key pair to disk (the key root's own copy). */
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
 * Materializes ONLY the public half of a key into a chain, so an anonymous
 * verifier finds it there without the key root. Writes `<chain>/keys/<fp>.pub`
 * if it is absent; the private key is NEVER written to a chain. Idempotent — a
 * chain already carrying the key is left untouched — and it never overwrites: a
 * `.pub` already present (materialized before, or, in the pathological case,
 * swapped) stays as-is, because a swapped public key is caught by the verifier's
 * fingerprint binding (it re-derives the loaded key's fingerprint), not here.
 */
export function materializePublicKey(chainLayout: ChainLayout, keyPair: KeyPair): void {
  const path = publicKeyPath(chainLayout, keyPair.fingerprint);
  if (existsSync(path)) return;
  mkdirSync(keysDir(chainLayout), { recursive: true });
  writeFileSync(path, publicKeyToPem(keyPair.publicKey), { encoding: 'utf-8' });
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
