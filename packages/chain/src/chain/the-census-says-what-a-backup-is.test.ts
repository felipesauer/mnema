/**
 * THE CENSUS SAYS WHAT A BACKUP IS — on the machine that made it — and a tail that is gone
 * is still said as gone.
 *
 * `mnema init` makes two keys: the machine's own, and a cold backup it tells the person to
 * carry off the machine. The backup signs nothing until it is restored, so it never has a
 * tail, and the census used to read it the only way the record alone can: a committed key
 * whose tail "may have been dropped (a botched merge), never written (an empty tail is not
 * versioned), or removed". That was the first thing a new user's first `verify` said about
 * the one key built so that nothing is lost.
 *
 * WHAT DECIDES IT IS TWO FACTS, AND NEITHER IS AN ABSENCE. The key root of the machine asking
 * holds a usable registration naming the key as a backup, and the record's enrollment fold
 * proves the key a member of the identity that registration names. The record does not carry
 * the role — `key.enrolled` has only the new key and its consent — so a verify that was handed
 * no key root, or a key root that never registered the key, reads it exactly as before.
 *
 * EACH CASE BELOW IS ONE SIDE: the backup said as one where it was registered; the same key
 * said as the record alone says it everywhere else; a tail that really went, still accused
 * beside the backup; a registration that does not count (a key the record never enrolled, a
 * role that is not a backup's); and the record's own account of a cut, which comes before
 * anything a registration says.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, keyEnrolled, runStarted, tailPruned } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { ensureBackupKey, readRegistration } from './backup.js';
import { openChainForWriting, verify } from './chain.js';
import { materializePublicKey, writeAnchor } from './keystore.js';
import { registrationPath } from './layout.js';
import { tailStanding } from './waiver.js';
import type { ChainWriter } from './writer.js';

const upcasters = catalogUpcasters();

let sandbox: string;
/** The tree: what a repository commits. */
let root: string;
/** This machine's key root: what no clone receives. */
let keyRoot: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-census-backup-'));
  root = join(sandbox, 'tree');
  keyRoot = join(sandbox, 'key-root');
  mkdirSync(root, { recursive: true });
  mkdirSync(keyRoot, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const env = (w: ChainWriter, subject: string) => ({
  at: '2026-09-28T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

/**
 * The tree a person has after their first `init`: founded by this machine's key, with the
 * cold backup registered at the key root and enrolled in the record. `enroll: false` leaves the
 * backup's public key committed and the enrollment out — a registration the record never took.
 */
function founded(enroll = true): { writer: ChainWriter; backup: string } {
  const writer = openChainForWriting(root, { keyRoot });
  writer.append(
    identityFounded(env(writer, writer.anchor), { foundingFp: writer.signerFingerprint }),
  );
  const made = ensureBackupKey({ root: keyRoot }, writer.anchor);
  if (made === null) throw new Error('fixture: no backup was made');
  const registration = readRegistration({ root: keyRoot }, made.fingerprint);
  if (!registration.usable) throw new Error(`fixture: the registration is ${registration.fault}`);
  materializePublicKey({ root }, registration);
  if (enroll) {
    writer.append(
      keyEnrolled(env(writer, writer.anchor), {
        newFp: registration.fingerprint,
        reverseSig: registration.reverseSig,
      }),
    );
  }
  writer.checkpoint();
  return { writer, backup: made.fingerprint };
}

describe('the census says what a backup is', () => {
  it('says the backup as one on the machine that registered it, with no word of loss', () => {
    const { writer, backup } = founded();
    const result = verify(root, upcasters, { keyRoot });

    expect(result.ok).toBe(true);
    expect(result.census).toEqual([
      {
        kind: 'backup-key',
        fingerprint: backup,
        anchor: writer.anchor,
        detail: expect.stringContaining('a backup signs nothing until it is restored'),
      },
    ]);
    const [note] = result.census;
    expect(note?.detail).not.toMatch(/dropped|botched|removed/);
    expect(result.summary).toContain('1 backup key(s), which sign nothing until restored');
    expect(result.summary).not.toContain('without a tail');
  });

  it('reads the same key as the record alone says it wherever the registration is not', () => {
    const { backup } = founded();
    const anotherMachine = join(sandbox, 'another-key-root');
    mkdirSync(anotherMachine);

    for (const result of [
      verify(root, upcasters),
      verify(root, upcasters, { keyRoot: anotherMachine }),
    ]) {
      expect(result.census).toEqual([
        {
          kind: 'key-without-tail',
          fingerprint: backup,
          detail: expect.stringContaining('the tail may have been dropped'),
          waivers: [],
        },
      ]);
    }
    // The verdict is the record's, whoever asks.
    expect(verify(root, upcasters, { keyRoot }).level).toBe(verify(root, upcasters).level);
    expect(verify(root, upcasters, { keyRoot }).ok).toBe(verify(root, upcasters).ok);
  });

  it('still accuses a tail that is gone, beside the backup it says calmly', () => {
    const { backup } = founded();
    // A colleague's machine writes into the same record, and its tail is then lost.
    const colleague = openChainForWriting(root, { keyRoot: join(sandbox, 'colleague') });
    colleague.append(
      identityFounded(env(colleague, colleague.anchor), {
        foundingFp: colleague.signerFingerprint,
      }),
    );
    colleague.append(runStarted(env(colleague, 'r-colleague'), { agent: 'cursor' }));
    colleague.checkpoint();
    rmSync(join(root, 'tails', colleague.tail), { recursive: true, force: true });

    const result = verify(root, upcasters, { keyRoot });
    expect(result.ok).toBe(true);
    expect(
      result.census
        .map((note) => `${note.kind} ${'fingerprint' in note ? note.fingerprint : ''}`)
        .sort(),
    ).toEqual([`backup-key ${backup}`, `key-without-tail ${colleague.signerFingerprint}`].sort());
    const lost = result.census.find((note) => note.kind === 'key-without-tail');
    expect(lost?.detail).toContain('the tail may have been dropped');
    expect(result.summary).toContain('1 committed key(s) without a tail');
    expect(result.summary).toContain('1 backup key(s)');
  });

  it('takes no registration for a key the record never enrolled into that identity', () => {
    // The backup's public key is committed and its registration is usable; the enrollment is
    // not in the record, so nothing proves the identity took the key in.
    const { backup } = founded(false);
    const result = verify(root, upcasters, { keyRoot });
    expect(result.census).toEqual([
      {
        kind: 'key-without-tail',
        fingerprint: backup,
        detail: expect.stringContaining('the tail may have been dropped'),
        waivers: [],
      },
    ]);
  });

  it('takes no registration whose role is not a backup’s', () => {
    // The role is not covered by the registration's signature, so the file stays usable with
    // another word in it — and a key registered for anything else is not said as a backup.
    const { backup } = founded();
    const path = registrationPath({ root: keyRoot }, backup);
    const fields = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...fields, role: 'laptop' })}\n`);
    expect(readRegistration({ root: keyRoot }, backup).usable).toBe(true);

    const [note] = verify(root, upcasters, { keyRoot }).census;
    expect(note?.kind).toBe('key-without-tail');
  });

  it('lets the record’s account of a cut come before anything a registration says', () => {
    // The adversarial reading: a backup restored, used to sign, and then its tail cut with the
    // record's authorization. The registration still says "backup", and the note the reader
    // needs is the cut's account, not the calm one.
    const { writer, backup } = founded();
    const restored = join(sandbox, 'restored');
    mkdirSync(join(restored, 'keys'), { recursive: true });
    // Restored the way a key root holds a signing key: the private half beside its public one.
    cpSync(join(keyRoot, 'backup', `${backup}.key`), join(restored, 'keys', `${backup}.key`));
    cpSync(join(keyRoot, 'keys', `${backup}.pub`), join(restored, 'keys', `${backup}.pub`));
    writeAnchor({ root }, backup, writer.anchor);
    const backupWriter = openChainForWriting(root, { keyRoot: restored });
    expect(backupWriter.signerFingerprint).toBe(backup);
    backupWriter.append(runStarted(env(backupWriter, 'r-restored'), { agent: 'claude' }));
    backupWriter.checkpoint();

    const standing = tailStanding({ root }, backupWriter.tail, upcasters);
    if (standing === undefined) throw new Error('fixture: no standing for the backup’s tail');
    writer.append(
      tailPruned(env(writer, standing.who), {
        tail: backupWriter.tail,
        throughHash: standing.throughHash,
        eventCount: standing.eventCount,
        reason: 'the restored machine was retired',
      }),
    );
    writer.checkpoint();
    rmSync(join(root, 'tails', backupWriter.tail), { recursive: true, force: true });

    const result = verify(root, upcasters, { keyRoot });
    expect(result.ok).toBe(true);
    expect(result.census).toHaveLength(1);
    const [note] = result.census;
    expect(note?.kind).toBe('key-without-tail');
    expect(note?.detail).toContain('the record names the cut');
    expect(note?.detail).toContain('1 event(s)');
  });
});
