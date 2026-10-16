/**
 * A REGISTRATION THAT NAMES AN IDENTITY THE RECORD NEVER FOUNDED IS NO BACKUP, and it does not
 * stop the verify that reads it.
 *
 * A key root says what a key was made FOR; it is the record's enrollment fold that says
 * whether an identity took the key in. A key root can hold a registration for an anchor this
 * record has no founding of (a key root shared across projects, a registration copied from
 * another clone): the fold then has no members for that anchor at all, which is a different
 * thing from an anchor with members that lack the key. The census must read it as it reads any
 * key it cannot tie to a tail, and the verdict must be the record's.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded } from '../events/build.js';
import { ensureBackupKey, readRegistration } from './backup.js';
import { openChainForWriting, verify } from './chain.js';
import { deriveAnchor } from './keys.js';
import { materializePublicKey } from './keystore.js';

let sandbox: string;
let root: string;
let keyRoot: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-backup-unfounded-'));
  root = join(sandbox, 'tree');
  keyRoot = join(sandbox, 'key-root');
  mkdirSync(root, { recursive: true });
  mkdirSync(keyRoot, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a registration for an identity the record never founded', () => {
  it('is read as a key without a tail, and the verdict is the record’s', () => {
    const writer = openChainForWriting(root, { keyRoot });
    writer.append(
      identityFounded(
        {
          at: '2026-10-15T00:00:00.000Z',
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: writer.anchor,
        },
        { foundingFp: writer.signerFingerprint },
      ),
    );
    writer.checkpoint();

    const elsewhere = deriveAnchor('a-fingerprint-this-record-never-saw');
    expect(elsewhere).not.toBe(writer.anchor);
    const made = ensureBackupKey({ root: keyRoot }, elsewhere);
    if (made === null) throw new Error('fixture: no backup was made');
    const registration = readRegistration({ root: keyRoot }, made.fingerprint);
    if (!registration.usable) throw new Error(`fixture: the registration is ${registration.fault}`);
    materializePublicKey({ root }, registration);

    const result = verify(root, undefined, { keyRoot });

    expect(result.ok).toBe(true);
    expect(result.census.map((note) => note.kind)).toEqual(['key-without-tail']);
    expect(result.census[0]).toMatchObject({ fingerprint: made.fingerprint });
  });
});
