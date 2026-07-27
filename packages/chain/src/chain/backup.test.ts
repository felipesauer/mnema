/**
 * The cold backup key at the key root.
 *
 * Two properties carry this feature, and both are pinned here. The first is that
 * the backup exists AT ALL and proves its own consent — a registration that
 * cannot be proven is worse than none, so a fault is reported, never smoothed
 * over. The second is that generating it does not change WHO this machine is:
 * the private half stays out of `keys/`, where the keystore adopts the first
 * private key it finds. That second one is not a detail — a machine whose
 * identity depends on directory order would sign as a different key between two
 * runs.
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_ROLE, ensureBackupKey, listRegistrations, readRegistration } from './backup.js';
import { deriveAnchor, generateKeyPair, publicKeyToPem } from './keys.js';
import { loadOrCreateKeyPair } from './keystore.js';
import {
  backupPrivateKeyPath,
  type ChainLayout,
  keysDir,
  publicKeyPath,
  registrationPath,
} from './layout.js';

let keyRoot: ChainLayout;

beforeEach(() => {
  keyRoot = { root: mkdtempSync(join(tmpdir(), 'mnema-backup-')) };
});

afterEach(() => {
  rmSync(keyRoot.root, { recursive: true, force: true });
});

/** Mints this machine's own key pair (what `openChainForWriting` does) and its anchor. */
function machineIdentity(): { fingerprint: string; anchor: string } {
  const fingerprint = loadOrCreateKeyPair(keyRoot).fingerprint;
  return { fingerprint, anchor: deriveAnchor(fingerprint) };
}

/** The `.key` files inside `keys/` — the candidates for THIS machine's identity. */
function privateKeysInKeysDir(): string[] {
  return readdirSync(keysDir(keyRoot)).filter((name) => name.endsWith('.key'));
}

describe('ensureBackupKey — generating the identity’s cold second key', () => {
  it('writes the public half and registration in keys/, and the private half in backup/', () => {
    const { anchor } = machineIdentity();
    const backup = ensureBackupKey(keyRoot, anchor);

    expect(backup?.created).toBe(true);
    const fingerprint = (backup as { fingerprint: string }).fingerprint;
    // The public half and the registration are beside the machine's own key.
    expect(existsSync(publicKeyPath(keyRoot, fingerprint))).toBe(true);
    expect(existsSync(registrationPath(keyRoot, fingerprint))).toBe(true);
    // The private half is in backup/, at the path reported, readable only by its owner.
    expect(backup?.privateKeyPath).toBe(backupPrivateKeyPath(keyRoot, fingerprint));
    expect(existsSync(backupPrivateKeyPath(keyRoot, fingerprint))).toBe(true);
    expect(statSync(backupPrivateKeyPath(keyRoot, fingerprint)).mode & 0o777).toBe(0o600);
  });

  it('NEVER leaves a second private key in keys/ — the machine’s identity is unchanged', () => {
    // This is the test the feature exists around: `loadOrCreateKeyPair` adopts the
    // FIRST private key in `keys/`, so a second one there makes which key the
    // machine speaks as depend on directory order. Before: one private key, one
    // identity. After generating a backup: still exactly one of each, the same one.
    const before = machineIdentity();
    expect(privateKeysInKeysDir()).toEqual([`${before.fingerprint}.key`]);

    ensureBackupKey(keyRoot, before.anchor);

    expect(privateKeysInKeysDir()).toEqual([`${before.fingerprint}.key`]);
    expect(loadOrCreateKeyPair(keyRoot).fingerprint).toBe(before.fingerprint);
    // And so the anchor it founds is still the same identity.
    expect(deriveAnchor(loadOrCreateKeyPair(keyRoot).fingerprint)).toBe(before.anchor);
  });

  it('generates exactly one backup per machine, and keeps reporting it', () => {
    const { anchor } = machineIdentity();
    const first = ensureBackupKey(keyRoot, anchor);
    const second = ensureBackupKey(keyRoot, anchor);

    expect(second?.created).toBe(false);
    expect(second?.fingerprint).toBe(first?.fingerprint);
    expect(listRegistrations(keyRoot)).toHaveLength(1);
  });

  it('does not mint a second backup once the private half has left the machine', () => {
    // The intended end state: the person moved the file off this disk. The
    // REGISTRATION is what says "this machine has a backup", so a later init must
    // not mint another one — that would silently make the copy they carry useless.
    const { anchor } = machineIdentity();
    const first = ensureBackupKey(keyRoot, anchor);
    rmSync((first as { privateKeyPath: string }).privateKeyPath);

    const second = ensureBackupKey(keyRoot, anchor);
    expect(second?.created).toBe(false);
    expect(second?.fingerprint).toBe(first?.fingerprint);
    expect(existsSync(second?.privateKeyPath as string)).toBe(false);
  });

  it('refuses to guess when a registration cannot be read', () => {
    const { anchor } = machineIdentity();
    const stranger = generateKeyPair();
    writeFileSync(registrationPath(keyRoot, stranger.fingerprint), 'not json at all\n', 'utf-8');

    // Nothing is created — an unreadable registration might BE this identity's
    // backup, and replacing it would strand the copy the person carries — and
    // nothing is named as "the backup" either.
    expect(ensureBackupKey(keyRoot, anchor)).toBeNull();
    expect(existsSync(join(keyRoot.root, 'backup'))).toBe(false);
  });

  it('is per IDENTITY: a registration for another anchor does not stand in for one', () => {
    // The aftermath of a lost key: the machine mints a new key, so a new anchor.
    // The old registration proves membership in an identity nobody can speak for
    // any more, so the new identity must get its own backup — otherwise the one
    // protection mnema offers is missing exactly when the loss happened.
    const older = ensureBackupKey(keyRoot, deriveAnchor('an-identity-that-was-lost'));
    const { anchor } = machineIdentity();

    const current = ensureBackupKey(keyRoot, anchor);

    expect(current?.created).toBe(true);
    expect(current?.fingerprint).not.toBe(older?.fingerprint);
    expect(listRegistrations(keyRoot).filter((r) => r.usable && r.anchor === anchor)).toHaveLength(
      1,
    );
    // And the machine's identity is still the machine's own key.
    expect(privateKeysInKeysDir()).toHaveLength(1);
  });
});

describe('registrations — proven, or reported as a fault', () => {
  it('reports the backup as usable, with the anchor and role it was registered for', () => {
    const { anchor } = machineIdentity();
    const backup = ensureBackupKey(keyRoot, anchor);

    const registrations = listRegistrations(keyRoot);
    expect(registrations).toHaveLength(1);
    const registration = registrations[0];
    expect(registration).toMatchObject({
      fingerprint: backup?.fingerprint,
      usable: true,
      anchor,
      role: BACKUP_ROLE,
    });
  });

  it('is unusable for ANOTHER anchor: the signature covers the one it names', () => {
    // The reverse signature covers `enroll:<anchor>:<fp>`, so it proves consent
    // for exactly one identity — which is also why one signature is replayable
    // into every tree of THAT identity, forever.
    const { anchor } = machineIdentity();
    const backup = ensureBackupKey(keyRoot, anchor);
    const registration = readRegistration(keyRoot, backup?.fingerprint as string);
    expect(registration.usable).toBe(true);

    const other = deriveAnchor('deadbeef');
    const path = registrationPath(keyRoot, backup?.fingerprint as string);
    const rewritten = { ...JSON.parse(readFileSync(path, 'utf-8')), anchor: other };
    writeFileSync(path, JSON.stringify(rewritten), 'utf-8');

    expect(readRegistration(keyRoot, backup?.fingerprint as string)).toMatchObject({
      usable: false,
      fault: 'unproven',
    });
  });

  it('reports a missing, malformed, swapped-key or unproven registration as its own fault', () => {
    const { anchor } = machineIdentity();

    // Missing: nothing registered for this fingerprint at all.
    const absent = generateKeyPair();
    expect(readRegistration(keyRoot, absent.fingerprint)).toMatchObject({
      usable: false,
      fault: 'unreadable',
    });

    // Malformed: a registration file that is not a registration.
    writeFileSync(registrationPath(keyRoot, absent.fingerprint), '{"anchor":""}', 'utf-8');
    expect(readRegistration(keyRoot, absent.fingerprint)).toMatchObject({
      usable: false,
      fault: 'unreadable',
    });

    // No public key: a well-formed registration with nothing to prove against.
    writeFileSync(
      registrationPath(keyRoot, absent.fingerprint),
      JSON.stringify({ anchor, role: BACKUP_ROLE, reverseSig: 'ab' }),
      'utf-8',
    );
    expect(readRegistration(keyRoot, absent.fingerprint)).toMatchObject({
      usable: false,
      fault: 'no-public-key',
    });

    // Swapped key: the `.pub` under this name is a DIFFERENT key. Without the
    // fingerprint binding, a signature made by that key would pass as this
    // fingerprint's consent.
    const impostor = generateKeyPair();
    writeFileSync(
      publicKeyPath(keyRoot, absent.fingerprint),
      publicKeyToPem(impostor.publicKey),
      'utf-8',
    );
    expect(readRegistration(keyRoot, absent.fingerprint)).toMatchObject({
      usable: false,
      fault: 'key-mismatch',
    });

    // Unproven: the right key, a signature that is not over its consent.
    writeFileSync(
      publicKeyPath(keyRoot, impostor.fingerprint),
      publicKeyToPem(impostor.publicKey),
      'utf-8',
    );
    writeFileSync(
      registrationPath(keyRoot, impostor.fingerprint),
      JSON.stringify({ anchor, role: BACKUP_ROLE, reverseSig: 'not-a-signature' }),
      'utf-8',
    );
    expect(readRegistration(keyRoot, impostor.fingerprint)).toMatchObject({
      usable: false,
      fault: 'unproven',
    });
  });

  it('reports every registration in fingerprint order, faults included', () => {
    const { anchor } = machineIdentity();
    ensureBackupKey(keyRoot, anchor);
    const broken = generateKeyPair();
    writeFileSync(registrationPath(keyRoot, broken.fingerprint), 'broken', 'utf-8');

    const listed = listRegistrations(keyRoot);
    expect(listed).toHaveLength(2);
    expect(listed.map((r) => r.fingerprint)).toEqual(
      [...listed.map((r) => r.fingerprint)].sort((a, b) => a.localeCompare(b)),
    );
    expect(listed.filter((r) => !r.usable)).toHaveLength(1);
  });

  it('reports nothing for a key root that does not exist yet', () => {
    // A first init reads the roster before anything has been written to the key
    // root; that must be an empty answer, not a crash.
    expect(listRegistrations({ root: join(keyRoot.root, 'not-created-yet') })).toEqual([]);
  });
});
