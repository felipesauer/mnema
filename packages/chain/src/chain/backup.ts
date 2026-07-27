/**
 * The keys an identity owns that do NOT sign on this machine: how they are
 * registered at the key root, and the COLD BACKUP key registered at founding.
 *
 * mnema refuses central recovery by design — an entity able to restore an
 * identity is an entity able to FORGE one, and that is the one permanent error.
 * The consequence is that the only protection against losing a machine's key is
 * PREVENTION: a second key, proven a member of the identity while the first key
 * still exists, kept where the machine's own loss cannot reach it. That second
 * key is what this module makes.
 *
 * Three files hold it, and the split between them is the whole design:
 *
 *   <keyRoot>/keys/<fp>.pub      the public half — what an enrollment names and
 *                                what a verifier checks a signature against
 *   <keyRoot>/keys/<fp>.enroll   the REGISTRATION: the signature over
 *                                `enroll:<anchor>:<fp>` proving this key
 *                                consented to join that anchor
 *   <keyRoot>/backup/<fp>.key    the private half, COLD — mode 0600, outside
 *                                `keys/`, and meant to leave the machine
 *
 * Why the private half is NOT in `keys/`: the keystore adopts the FIRST private
 * key it finds there as this machine's identity, so a second one would make
 * WHICH key the machine speaks as depend on directory order — it could differ
 * between two runs. `backup/` is a place nothing looks for an identity.
 *
 * Why the registration is replayable: the signature covers fixed values (the
 * anchor and the new fingerprint), so ONE signature proves consent forever, in
 * every tree. A tree founded a year from now can still enroll the backup key
 * without its private half ever returning to this machine — which is what lets
 * every tree be born carrying the whole identity.
 *
 * Why a registration is verified HERE, before it is used: an enrollment event is
 * append-only. Emitting one whose proof does not check out would leave that tree
 * permanently failing verification, with no way to take the event back. So a
 * registration is only ever reported as usable once its signature has been
 * checked against the very key it names — a bad registration is refused while
 * refusing is still free.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

import { enrollmentMessage } from '../events/build.js';
import {
  fingerprintOf,
  generateKeyPair,
  type KeyObject,
  privateKeyToPem,
  publicKeyFromPem,
  publicKeyToPem,
  sign,
  verify as verifySignature,
} from './keys.js';
import {
  backupDir,
  backupPrivateKeyPath,
  type ChainLayout,
  keysDir,
  publicKeyPath,
  registrationPath,
} from './layout.js';

/** The role a registration records for the cold key created at founding. */
export const BACKUP_ROLE = 'backup';

const REGISTRATION_SUFFIX = '.enroll';

/** Why a registration cannot be used to enroll its key. */
export type RegistrationFault =
  /** The file is missing, or not the shape a registration has. */
  | 'unreadable'
  /** No public key at the key root for this fingerprint, so nothing to prove against. */
  | 'no-public-key'
  /** The public key at the key root is not the key this registration names. */
  | 'key-mismatch'
  /** The signature does not prove the key consented to that anchor. */
  | 'unproven';

/** A key registered at the key root as a member of this machine's identity. */
export type KeyRegistration =
  | {
      readonly fingerprint: string;
      readonly usable: true;
      /** The anchor the signature covers — the registration proves nothing for any other. */
      readonly anchor: string;
      /** What the key was registered for; {@link BACKUP_ROLE} is the cold key. */
      readonly role: string;
      /** The new key's own signature over `enroll:<anchor>:<fp>`, hex. */
      readonly reverseSig: string;
      /** The public half, ready to be materialized into a tree. */
      readonly publicKey: KeyObject;
    }
  | {
      readonly fingerprint: string;
      readonly usable: false;
      readonly fault: RegistrationFault;
    };

/** The cold backup key of this machine's identity. */
export interface BackupKey {
  readonly fingerprint: string;
  /**
   * Where the cold private half is written — outside `keys/`. The path is
   * reported whether or not this call created the key; the FILE may be gone,
   * which is the intended end state (the human moved it off the machine).
   */
  readonly privateKeyPath: string;
  /** True when THIS call generated it — the one moment the human must act on. */
  readonly created: boolean;
}

/**
 * Every key registered at the key root, in fingerprint order. Each is reported
 * as usable — with the material an enrollment needs — or with the fault that
 * makes it unusable; a broken registration is never silently dropped, because
 * dropping it would leave a person believing they hold a backup they cannot use.
 */
export function listRegistrations(keyRoot: ChainLayout): KeyRegistration[] {
  const dir = keysDir(keyRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(REGISTRATION_SUFFIX))
    .map((name) => name.slice(0, -REGISTRATION_SUFFIX.length))
    .sort()
    .map((fingerprint) => readRegistration(keyRoot, fingerprint));
}

/**
 * Reads one key's registration and decides whether it can be used. Usable means
 * PROVEN: the public key at the key root is really the key the registration
 * names (its fingerprint re-derives), and the signature over
 * `enroll:<anchor>:<fp>` verifies against it. Everything short of that comes
 * back as a fault.
 */
export function readRegistration(keyRoot: ChainLayout, fingerprint: string): KeyRegistration {
  const fields = readFields(registrationPath(keyRoot, fingerprint));
  if (fields === null) return { fingerprint, usable: false, fault: 'unreadable' };

  const pubPath = publicKeyPath(keyRoot, fingerprint);
  if (!existsSync(pubPath)) return { fingerprint, usable: false, fault: 'no-public-key' };
  let publicKey: KeyObject;
  try {
    publicKey = publicKeyFromPem(readFileSync(pubPath, 'utf-8'));
  } catch {
    return { fingerprint, usable: false, fault: 'no-public-key' };
  }
  // Bind the file to the name: without this, swapping `<fp>.pub` for another key
  // would let a signature made by THAT key pass as this fingerprint's consent.
  if (fingerprintOf(publicKey) !== fingerprint) {
    return { fingerprint, usable: false, fault: 'key-mismatch' };
  }
  if (!provesConsent(publicKey, fields.anchor, fingerprint, fields.reverseSig)) {
    return { fingerprint, usable: false, fault: 'unproven' };
  }
  return {
    fingerprint,
    usable: true,
    anchor: fields.anchor,
    role: fields.role,
    reverseSig: fields.reverseSig,
    publicKey,
  };
}

/**
 * Makes sure the identity at `anchor` has a cold backup key, generating and
 * registering one on first use, and reports it either way.
 *
 * The backup belongs to the IDENTITY, not to the machine or the project: it is
 * keyed by anchor. One is generated once per anchor and then only re-reported —
 * never a second one, because a second cold key would silently turn whatever
 * copy the person already carries off the machine into a worthless file. But a
 * registration made for a DIFFERENT anchor does not count as this identity's
 * backup and does not stand in for one: a machine whose key was lost mints a new
 * identity, and that new identity needs its own protection, or the feature is
 * absent exactly in the aftermath it exists for. The stale registration stays on
 * disk and is reported (it is refused by the enrollment, which says why).
 *
 * A registration that cannot be READ blocks generation and returns null: it
 * might be this identity's own backup, and minting a replacement over an
 * unreadable one is the one mistake that strands a person's only copy. The fault
 * reaches them through {@link listRegistrations} instead of being repaired behind
 * their back.
 *
 * The three files are written private half FIRST, then the public half, then the
 * registration — the registration is what says "this identity has a backup", so
 * it is written last. A crash before it leaves an unregistered orphan that the
 * next run ignores (and replaces with a fresh backup), never a registration whose
 * key material is missing.
 */
export function ensureBackupKey(keyRoot: ChainLayout, anchor: string): BackupKey | null {
  const registered = listRegistrations(keyRoot);
  const existing = registered.find(
    (r) => r.usable && r.role === BACKUP_ROLE && r.anchor === anchor,
  );
  if (existing !== undefined) {
    return {
      fingerprint: existing.fingerprint,
      privateKeyPath: backupPrivateKeyPath(keyRoot, existing.fingerprint),
      created: false,
    };
  }
  if (registered.some((r) => !r.usable)) return null;

  const keyPair = generateKeyPair();
  const privatePath = backupPrivateKeyPath(keyRoot, keyPair.fingerprint);
  mkdirSync(backupDir(keyRoot), { recursive: true, mode: 0o700 });
  writeFileSync(privatePath, privateKeyToPem(keyPair.privateKey), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  mkdirSync(keysDir(keyRoot), { recursive: true });
  writeFileSync(
    publicKeyPath(keyRoot, keyPair.fingerprint),
    publicKeyToPem(keyPair.publicKey),
    'utf-8',
  );
  const reverseSig = Buffer.from(
    sign(enrollmentMessage(anchor, keyPair.fingerprint), keyPair.privateKey),
  ).toString('hex');
  writeFileSync(
    registrationPath(keyRoot, keyPair.fingerprint),
    `${JSON.stringify({ anchor, role: BACKUP_ROLE, reverseSig })}\n`,
    'utf-8',
  );
  return { fingerprint: keyPair.fingerprint, privateKeyPath: privatePath, created: true };
}

/** The fields of a registration file, or null when it is not one. */
function readFields(path: string): { anchor: string; role: string; reverseSig: string } | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const anchor = record.anchor;
  const reverseSig = record.reverseSig;
  const role = record.role;
  if (typeof anchor !== 'string' || anchor.length === 0) return null;
  if (typeof reverseSig !== 'string' || reverseSig.length === 0) return null;
  return { anchor, role: typeof role === 'string' ? role : '', reverseSig };
}

/** Whether `reverseSig` is this key's own signature over `enroll:<anchor>:<fp>`. */
function provesConsent(
  publicKey: KeyObject,
  anchor: string,
  fingerprint: string,
  reverseSig: string,
): boolean {
  try {
    return verifySignature(
      enrollmentMessage(anchor, fingerprint),
      Buffer.from(reverseSig, 'hex'),
      publicKey,
    );
  } catch {
    return false;
  }
}
