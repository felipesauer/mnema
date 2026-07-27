/**
 * Establishing an identity into a tree, WHOLE.
 *
 * The mechanism (found, enroll, revoke) is pinned by the chain's own suite and by
 * the enrollment integration test. What is pinned HERE is the policy on top: a
 * tree that is deliberately created is born knowing every key of the identity,
 * not just the key at hand — because mnema refuses central recovery, so a key
 * that was never proven a member while the first key existed can never become one
 * afterwards.
 *
 * The properties that matter, and why each would bite if it broke:
 *   - a SECOND tree, created later, carries the backup too (otherwise a project
 *     created tomorrow is silently uncovered);
 *   - running it twice enrolls once (otherwise every init grows the chain);
 *   - a REVOKED key is not resurrected (otherwise a retired key returns because
 *     its file is still on disk);
 *   - the tree verifies fully signed with both keys (otherwise the whole feature
 *     buys a red chain).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  ensureBackupKey,
  generateKeyPair,
  listRegistrations,
  openChainForWriting,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from './clock.js';
import { establishIdentity, revokeKey } from './identity-operations.js';
import type { WriteContext } from './operations.js';

const upcasters = catalogUpcasters();

let keyRoot: string;
let scratch: string[] = [];

beforeEach(() => {
  scratch = [];
  keyRoot = tmp('mnema-identity-keyroot-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A clock the test drives, so `at` is deterministic and monotonic across trees. */
let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-07-27T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

/** A fresh tree, plus the write context over it — the machine's one key root. */
function openTree(prefix: string): { root: string; writer: ChainWriter; ctx: WriteContext } {
  const root = tmp(prefix);
  const writer = openChainForWriting(root, { keyRoot });
  const layout: ChainLayout = { root };
  return { root, writer, ctx: { writer, layout, upcasters, clock } };
}

/** The fingerprints a tree has enrolled (the `key.enrolled` facts it carries). */
function enrolledIn(root: string): string[] {
  return orderedEvents({ root }, upcasters)
    .filter((e) => e.kind === 'key.enrolled')
    .map((e) => (e.payload as { newFp: string }).newFp);
}

describe('establishIdentity — a tree is born with the whole identity', () => {
  it('founds the anchor, creates the cold backup, and enrolls it', () => {
    const tree = openTree('mnema-identity-tree-');
    const established = establishIdentity(tree.ctx, { keyRoot });

    expect(established.anchor).toBe(tree.writer.anchor);
    expect(established.backup?.created).toBe(true);
    expect(established.enrolled).toEqual([established.backup?.fingerprint]);
    expect(established.declined).toEqual([]);
    // Both facts are on the chain: the founding of the machine's key, and the
    // enrollment of a key that has never signed here.
    expect(orderedEvents({ root: tree.root }, upcasters).map((e) => e.kind)).toEqual([
      'identity.founded',
      'key.enrolled',
    ]);
    // The public half is materialized, so an anonymous verifier can check the
    // consent signature without ever seeing the key root.
    expect(existsSync(join(tree.root, 'keys', `${established.backup?.fingerprint}.pub`))).toBe(
      true,
    );
  });

  it('the tree verifies, fully signed, with two keys in it', () => {
    const tree = openTree('mnema-identity-tree-');
    establishIdentity(tree.ctx, { keyRoot });
    tree.writer.checkpoint();

    const verdict = verify(tree.root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
    expect(verdict.issues).toEqual([]);
  });

  it('a SECOND tree created later carries the same backup — one signature, every tree', () => {
    const first = openTree('mnema-identity-first-');
    const established = establishIdentity(first.ctx, { keyRoot });
    const backupFp = established.backup?.fingerprint as string;

    const second = openTree('mnema-identity-second-');
    const later = establishIdentity(second.ctx, { keyRoot });

    // Same identity, same backup — the registration was replayed, not re-made.
    expect(later.anchor).toBe(established.anchor);
    expect(later.backup?.created).toBe(false);
    expect(later.enrolled).toEqual([backupFp]);
    expect(enrolledIn(second.root)).toEqual([backupFp]);
    expect(verify(second.root).ok).toBe(true);
  });

  it('is idempotent: establishing twice enrolls the backup once', () => {
    const tree = openTree('mnema-identity-tree-');
    const first = establishIdentity(tree.ctx, { keyRoot });
    const before = orderedEvents({ root: tree.root }, upcasters).length;

    const again = establishIdentity(tree.ctx, { keyRoot });

    expect(again.enrolled).toEqual([]);
    expect(again.backup?.fingerprint).toBe(first.backup?.fingerprint);
    expect(orderedEvents({ root: tree.root }, upcasters).length).toBe(before);
    expect(enrolledIn(tree.root)).toHaveLength(1);
  });

  it('does NOT resurrect a revoked key, even with its registration still on disk', () => {
    // The reason the roster is read from the CHAIN and not from the key root's
    // files: a key retired from this identity must stay retired. Reading the
    // files alone, a later init would re-enroll it — and because an enrollment
    // checkpoints itself, that re-enrollment would take effect.
    const tree = openTree('mnema-identity-tree-');
    const established = establishIdentity(tree.ctx, { keyRoot });
    const backupFp = established.backup?.fingerprint as string;

    revokeKey(tree.ctx, { revokedFp: backupFp, reason: 'the cold copy was exposed' });
    const afterRevoke = orderedEvents({ root: tree.root }, upcasters).length;

    const again = establishIdentity(tree.ctx, { keyRoot });

    expect(again.enrolled).toEqual([]);
    expect(orderedEvents({ root: tree.root }, upcasters).length).toBe(afterRevoke);
    expect(enrolledIn(tree.root)).toEqual([backupFp]); // the original one, not a second
  });

  it('declines a registration made for ANOTHER identity, and gives this one its own backup', () => {
    // The machine's own anchor is what a registration must cover. One made for a
    // different anchor proves nothing here — emitting it anyway would leave this
    // tree permanently failing verification — so it is refused with its reason,
    // and this identity gets a backup of its own. (This is the state after a lost
    // key: the machine mints a new key, so a new anchor, and the protection must
    // not go missing exactly then.)
    ensureBackupKey({ root: keyRoot }, 'mnid:some-other-identity');
    const stale = listRegistrations({ root: keyRoot })[0]?.fingerprint as string;

    const tree = openTree('mnema-identity-tree-');
    const established = establishIdentity(tree.ctx, { keyRoot });

    expect(established.backup?.created).toBe(true);
    expect(established.backup?.fingerprint).not.toBe(stale);
    expect(established.enrolled).toEqual([established.backup?.fingerprint]);
    expect(established.declined).toEqual([
      {
        fingerprint: stale,
        reason: 'it is registered for another identity (mnid:some-other-identity)',
      },
    ]);
    // The stale key was never appended, so the tree stays green.
    expect(enrolledIn(tree.root)).toEqual([established.backup?.fingerprint]);
    expect(verify(tree.root).ok).toBe(true);
  });

  it('declines an unreadable registration with a reason a person can act on', () => {
    const broken = generateKeyPair();
    mkdirSync(join(keyRoot, 'keys'), { recursive: true });
    writeFileSync(join(keyRoot, 'keys', `${broken.fingerprint}.enroll`), 'corrupted', 'utf-8');

    const tree = openTree('mnema-identity-tree-');
    const established = establishIdentity(tree.ctx, { keyRoot });

    // No backup could be identified, so none is claimed — and the fault is
    // reported rather than repaired behind the person's back.
    expect(established.backup).toBeNull();
    expect(established.declined).toEqual([
      {
        fingerprint: broken.fingerprint,
        reason: 'its registration at the key root cannot be read',
      },
    ]);
    expect(verify(tree.root).ok).toBe(true);
  });
});
