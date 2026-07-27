/**
 * Restoring a key — the only recovery mnema has, and the half of the backup
 * feature that decides whether the other half was worth anything.
 *
 * The one property everything here exists to protect: a restored key must speak
 * for the identity it PROTECTED, never for a new one. A private key installed
 * without the anchor its tree recorded founds a fresh identity on its next write —
 * a split, appended to a tree the team shares, unappendable-back. So the tests
 * below are mostly refusals, and the refusals are the point:
 *
 *   - the anchor after the loss is the anchor from before it (the whole feature);
 *   - a key nothing proves a member of is refused, even when the tree NAMES it;
 *   - a second private key is never left at the key root (the machine would then
 *     choose its identity by directory order);
 *   - a refusal writes nothing at all — a half-done restore is the split.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  deriveAnchor,
  enrollmentMessage,
  generateKeyPair,
  listPrivateKeyFingerprints,
  openChainForWriting,
  sign,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from '../workflow/clock.js';
import { enrollKey, establishIdentity, revokeKey } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { restoreKey } from './restore.js';

const upcasters = catalogUpcasters();

let tree: string;
let keyRoot: string;
let vault: string;
let scratch: string[] = [];

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-restore-tree-');
  keyRoot = tmp('mnema-restore-keyroot-');
  vault = tmp('mnema-restore-vault-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A clock the test drives, so `at` is deterministic and monotonic. */
let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-07-27T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/** Opens a machine's writer over a tree, keyed by a key root. */
function machine(treeRoot: string, root: string): { writer: ChainWriter; ctx: WriteContext } {
  const writer = openChainForWriting(treeRoot, { keyRoot: root });
  const layout: ChainLayout = { root: treeRoot };
  return { writer, ctx: { writer, layout, upcasters, clock } };
}

/**
 * The state the loss scenario starts from: a project established with its cold
 * backup key, the backup's private half copied to a vault OUTSIDE the machine,
 * and the primary private key deleted — the disk is fine, the key is gone.
 */
function establishThenLoseTheKey(): {
  anchorBefore: string;
  primaryFp: string;
  backupFp: string;
  vaultCopy: string;
} {
  const first = machine(tree, keyRoot);
  const established = establishIdentity(first.ctx, { keyRoot });
  first.writer.checkpoint();
  const backupFp = established.backup?.fingerprint as string;
  const primaryFp = first.writer.signerFingerprint;

  // The person moved the cold private half off the machine, as init told them to.
  const vaultCopy = join(vault, 'mnema-backup.key');
  writeFileSync(vaultCopy, readFileSync(established.backup?.privateKeyPath as string, 'utf-8'), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  rmSync(join(keyRoot, 'backup'), { recursive: true, force: true });

  // The loss: the machine's own private key is gone. Everything else survives —
  // the committed tree (git) and the public material at the key root.
  unlinkSync(join(keyRoot, 'keys', `${primaryFp}.key`));

  return { anchorBefore: established.anchor, primaryFp, backupFp, vaultCopy };
}

describe('restoreKey — the identity after the loss is the identity from before it', () => {
  it('adopts the anchor the tree proves, and the machine signs as it again', () => {
    const lost = establishThenLoseTheKey();

    // Before the restore the machine has NO private key: it would mint a fresh
    // one and found a new identity on its next write. That is the split.
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);

    const restored = restoreKey({
      privateKeyPath: lost.vaultCopy,
      keyRoot,
      tree,
      upcasters,
    });

    expect(restored).toMatchObject({
      ok: true,
      fingerprint: lost.backupFp,
      anchor: lost.anchorBefore,
      membership: 'enrolled',
    });

    // The proof that matters: a writer opened now speaks for the SAME anchor as
    // before the loss, with the backup key.
    const after = machine(tree, keyRoot);
    expect(after.writer.signerFingerprint).toBe(lost.backupFp);
    expect(after.writer.anchor).toBe(lost.anchorBefore);
    expect(after.writer.hasAnchor).toBe(true);
    // And it is not the anchor the restored key would have founded on its own.
    expect(after.writer.anchor).not.toBe(deriveAnchor(lost.backupFp));
  });

  it('continues the chain: the new event carries the original who, and verify is green', () => {
    const lost = establishThenLoseTheKey();
    restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters });

    const after = machine(tree, keyRoot);
    const captured = captureMemory(after.ctx, { content: 'written after the recovery' });
    after.writer.checkpoint();

    expect(captured.ok).toBe(true);
    const memory = orderedEvents({ root: tree }, upcasters).find(
      (e) => e.kind === 'memory.captured',
    );
    expect(memory?.who).toBe(lost.anchorBefore);
    expect(memory?.signerFp).toBe(lost.backupFp);

    // The whole tree — two tails, two keys, one identity — still verifies, and
    // every event is signature-covered.
    const verdict = verify(tree, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('leaves the vault copy exactly where it was, byte for byte', () => {
    const lost = establishThenLoseTheKey();
    const before = readFileSync(lost.vaultCopy, 'utf-8');

    const restored = restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters });

    expect(restored.ok).toBe(true);
    // The copy is read, never consumed: it is still the only copy off-machine,
    // and a person who deletes it after a successful restore must be told not to.
    expect(existsSync(lost.vaultCopy)).toBe(true);
    expect(readFileSync(lost.vaultCopy, 'utf-8')).toBe(before);
    // What was installed is a copy of it, private-only mode.
    const installed = (restored as { installedAt: string }).installedAt;
    expect(installed).toBe(join(keyRoot, 'keys', `${lost.backupFp}.key`));
    expect(readFileSync(installed, 'utf-8')).toBe(before);
  });

  it('restores the PRIMARY key too — a founding proves membership like an enrollment', () => {
    const first = machine(tree, keyRoot);
    establishIdentity(first.ctx, { keyRoot });
    first.writer.checkpoint();
    const primaryFp = first.writer.signerFingerprint;
    const anchorBefore = first.writer.anchor;

    // The person's copy is of the key that FOUNDED the identity (a whole key root
    // backup, say), and the machine's own copy is gone.
    const vaultCopy = join(vault, 'primary.key');
    writeFileSync(vaultCopy, readFileSync(join(keyRoot, 'keys', `${primaryFp}.key`), 'utf-8'));
    unlinkSync(join(keyRoot, 'keys', `${primaryFp}.key`));

    const restored = restoreKey({ privateKeyPath: vaultCopy, keyRoot, tree, upcasters });

    expect(restored).toMatchObject({
      ok: true,
      fingerprint: primaryFp,
      anchor: anchorBefore,
      membership: 'founded',
    });
    expect(machine(tree, keyRoot).writer.anchor).toBe(anchorBefore);
  });

  it('is repeatable for the same key — a second project needs the anchor recorded too', () => {
    const lost = establishThenLoseTheKey();
    expect(restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters }).ok).toBe(true);

    // The anchor is recorded per TREE (the writer reads it from the tree it writes
    // to), so recovery in a second project is a second restore. Refusing here
    // because "a key is already installed" would leave that project with no way
    // to recover — while still leaving exactly ONE private key at the key root.
    const again = restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters });
    expect(again).toMatchObject({ ok: true, anchor: lost.anchorBefore });
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([lost.backupFp]);
  });
});

describe('restoreKey — refusals, each writing nothing', () => {
  it('refuses UNREADABLE_KEY for a file that is not a private key, and for none at all', () => {
    const junk = join(vault, 'not-a-key.txt');
    writeFileSync(junk, 'BEGIN NOTHING\n', 'utf-8');

    expect(restoreKey({ privateKeyPath: junk, keyRoot, tree, upcasters })).toMatchObject({
      ok: false,
      code: 'UNREADABLE_KEY',
    });
    expect(
      restoreKey({ privateKeyPath: join(vault, 'absent.key'), keyRoot, tree, upcasters }),
    ).toMatchObject({ ok: false, code: 'UNREADABLE_KEY' });
    // Nothing installed by either.
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);
  });

  it('refuses KEY_PRESENT while another private key is installed — never two in keys/', () => {
    const first = machine(tree, keyRoot);
    const established = establishIdentity(first.ctx, { keyRoot });
    first.writer.checkpoint();
    const primaryFp = first.writer.signerFingerprint;
    const backupFp = established.backup?.fingerprint as string;

    // The key was NOT lost: the person restores the backup anyway. Two private
    // keys in keys/ would make the machine's identity depend on directory order,
    // so this is refused — the ambiguity is never created.
    const refused = restoreKey({
      privateKeyPath: established.backup?.privateKeyPath as string,
      keyRoot,
      tree,
      upcasters,
    });

    expect(refused).toMatchObject({ ok: false, code: 'KEY_PRESENT' });
    expect((refused as { message: string }).message).toContain(primaryFp);
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([primaryFp]);
    // And the tree recorded no anchor for the key it refused to install.
    expect(existsSync(join(tree, 'keys', `${backupFp}.anchor`))).toBe(false);
  });

  it('refuses NOT_A_MEMBER for a key no fact in the tree decided about', () => {
    const lost = establishThenLoseTheKey();
    const stranger = generateKeyPair();
    const strangerFile = join(vault, 'stranger.key');
    writeFileSync(strangerFile, stranger.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const refused = restoreKey({ privateKeyPath: strangerFile, keyRoot, tree, upcasters });

    expect(refused).toMatchObject({ ok: false, code: 'NOT_A_MEMBER' });
    // A key the anchor never accepted must not be installed: every event it wrote
    // would fail verification, and an event cannot be taken back.
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);
    expect(existsSync(join(tree, 'keys', `${stranger.fingerprint}.anchor`))).toBe(false);
    // The real backup still restores — the refusal was about the key, not the tree.
    expect(restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters }).ok).toBe(true);
  });

  it('refuses a key the tree merely NAMES — consent is proven by the key, not asserted', () => {
    // The adversarial case: a tree that carries an enrollment naming a stranger's
    // fingerprint, with a reverse signature it could not have made. Accepting it
    // would let any repository hand a restored key an identity by writing its
    // fingerprint down, and the key would sign as an anchor it never joined.
    const first = machine(tree, keyRoot);
    establishIdentity(first.ctx, { keyRoot });
    const stranger = generateKeyPair();
    const impostor = generateKeyPair();
    enrollKey(first.ctx, {
      newFp: stranger.fingerprint,
      // A well-formed signature over the right message — by the WRONG key.
      reverseSig: Buffer.from(
        sign(
          enrollmentMessage(first.writer.anchor, stranger.fingerprint),
          impostor.privateKey,
        ) as Uint8Array,
      ).toString('hex'),
    });

    const strangerFile = join(vault, 'named-but-not-consenting.key');
    writeFileSync(strangerFile, stranger.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    // Restored on the stranger's OWN machine (a key root with no key), so the
    // refusal is about the membership and not about a key already installed.
    const refused = restoreKey({
      privateKeyPath: strangerFile,
      keyRoot: tmp('mnema-restore-keyroot-stranger-'),
      tree,
      upcasters,
    });

    expect(refused).toMatchObject({ ok: false, code: 'NOT_A_MEMBER' });
    expect(existsSync(join(tree, 'keys', `${stranger.fingerprint}.anchor`))).toBe(false);

    // The same holds for a reverse signature that is not even signature-shaped —
    // a corrupted payload is refused, never read as consent.
    const garbled = generateKeyPair();
    enrollKey(first.ctx, { newFp: garbled.fingerprint, reverseSig: 'not-hex-at-all' });
    const garbledFile = join(vault, 'garbled-consent.key');
    writeFileSync(garbledFile, garbled.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    expect(
      restoreKey({
        privateKeyPath: garbledFile,
        keyRoot: tmp('mnema-restore-keyroot-garbled-'),
        tree,
        upcasters,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_A_MEMBER' });
  });

  it('refuses REVOKED_KEY for a key the identity retired', () => {
    const lost = establishThenLoseTheKey();

    // Only a member can revoke, so the scenario runs in the honest order: the key
    // is restored, it retires ITSELF from the identity (the vault copy leaked),
    // and only then is it lost again and a restore attempted.
    restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters });
    const restoredMachine = machine(tree, keyRoot);
    revokeKey(restoredMachine.ctx, { revokedFp: lost.backupFp, reason: 'the vault copy leaked' });
    unlinkSync(join(keyRoot, 'keys', `${lost.backupFp}.key`));
    unlinkSync(join(tree, 'keys', `${lost.backupFp}.anchor`));

    const refused = restoreKey({ privateKeyPath: lost.vaultCopy, keyRoot, tree, upcasters });

    expect(refused).toMatchObject({ ok: false, code: 'REVOKED_KEY' });
    expect((refused as { message: string }).message).toContain(lost.anchorBefore);
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);
  });

  it('refuses AMBIGUOUS_MEMBERSHIP when two identities in one tree both proved the key', () => {
    // Two machines write to the same tree — each founds its own anchor — and both
    // enroll the SAME key, each with that key's genuine consent. Which identity
    // the key should speak for here is the person's call, not a coin flip made on
    // their behalf, so the restore refuses and names both.
    const shared = generateKeyPair();
    const consent = (anchor: string): string =>
      Buffer.from(
        sign(enrollmentMessage(anchor, shared.fingerprint), shared.privateKey) as Uint8Array,
      ).toString('hex');

    const one = machine(tree, keyRoot);
    enrollKey(one.ctx, { newFp: shared.fingerprint, reverseSig: consent(one.writer.anchor) });
    const otherKeyRoot = tmp('mnema-restore-keyroot-b-');
    const two = machine(tree, otherKeyRoot);
    enrollKey(two.ctx, { newFp: shared.fingerprint, reverseSig: consent(two.writer.anchor) });

    const sharedFile = join(vault, 'shared.key');
    writeFileSync(sharedFile, shared.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const refused = restoreKey({
      privateKeyPath: sharedFile,
      keyRoot: tmp('mnema-restore-keyroot-empty-'),
      tree,
      upcasters,
    });

    expect(refused).toMatchObject({ ok: false, code: 'AMBIGUOUS_MEMBERSHIP' });
    expect((refused as { message: string }).message).toContain(one.writer.anchor);
    expect((refused as { message: string }).message).toContain(two.writer.anchor);
  });
});
