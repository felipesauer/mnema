/**
 * The key root is separate from the chain: a person's private key lives in ONE
 * key root and is never copied; each chain it writes to only MATERIALIZES the
 * public half. This is the identity primitive the tree topology sits on — one
 * identity, several chains (a project's public tree, its private one, a global
 * one), the same `who` across all — so it is pinned here, on the real API
 * (`openChainForWriting(chainRoot, { keyRoot })`), not the keyRoot == chainRoot
 * shorthand the other suites use.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityFounded, taskCreated } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { privateKeyPath, publicKeyPath } from './layout.js';
import type { ChainWriter } from './writer.js';

let keyRoot: string;
let chainA: string;
let chainB: string;
const scratch: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

beforeEach(() => {
  keyRoot = tmp('mnema-keyroot-');
  chainA = tmp('mnema-chainA-');
  chainB = tmp('mnema-chainB-');
});

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Founds a writer's anchor and writes one task, so the tail verifies fully. */
function foundAndWrite(w: ChainWriter, subject: string): void {
  const env = (s: string) => ({
    at: '2026-07-21T00:00:00.000Z',
    who: w.anchor,
    signerFp: w.signerFingerprint,
    subject: s,
  });
  w.append(identityFounded(env(w.anchor), { foundingFp: w.signerFingerprint }));
  w.append(taskCreated(env(subject), { title: subject }));
  w.checkpoint();
}

describe('key root separate from chain — materialization', () => {
  it('writes the private key ONLY under the key root, the public key into the chain', () => {
    const w = openChainForWriting(chainA, { keyRoot });
    const fp = w.signerFingerprint;

    // The private key lives in the key root, never in the chain.
    expect(existsSync(privateKeyPath({ root: keyRoot }, fp))).toBe(true);
    expect(existsSync(privateKeyPath({ root: chainA }, fp))).toBe(false);

    // The public key is materialized into the chain (what an anonymous verifier
    // reads), and also present in the key root (its own copy).
    expect(existsSync(publicKeyPath({ root: chainA }, fp))).toBe(true);
    expect(existsSync(publicKeyPath({ root: keyRoot }, fp))).toBe(true);

    // The chain's keys/ directory carries no private key at all.
    const chainKeys = readdirSync(join(chainA, 'keys'));
    expect(chainKeys.some((f) => f.endsWith('.key'))).toBe(false);
    expect(chainKeys).toContain(`${fp}.pub`);
  });

  it('materializes byte-identically to the key root public key', () => {
    const w = openChainForWriting(chainA, { keyRoot });
    const fp = w.signerFingerprint;
    const inChain = readFileSync(publicKeyPath({ root: chainA }, fp), 'utf-8');
    const inKeyRoot = readFileSync(publicKeyPath({ root: keyRoot }, fp), 'utf-8');
    expect(inChain).toBe(inKeyRoot);
  });
});

describe('one key root, several chains — one identity', () => {
  it('gives the same anchor and fingerprint to every chain it backs', () => {
    const a = openChainForWriting(chainA, { keyRoot });
    const b = openChainForWriting(chainB, { keyRoot });
    // One key → one identity, the same `who` in both chains.
    expect(a.anchor).toBe(b.anchor);
    expect(a.signerFingerprint).toBe(b.signerFingerprint);
  });

  it('keeps a DISTINCT tail per chain, so their events never overlap', () => {
    const a = openChainForWriting(chainA, { keyRoot });
    const b = openChainForWriting(chainB, { keyRoot });
    const tailA = readdirSync(join(chainA, 'tails'))[0];
    const tailB = readdirSync(join(chainB, 'tails'))[0];
    // Same fingerprint prefix (same key), different installation suffix (per
    // chain), so the two tails are distinct directories.
    expect(tailA).toBeDefined();
    expect(tailB).toBeDefined();
    expect(tailA).not.toBe(tailB);
    expect(tailA?.startsWith(a.signerFingerprint)).toBe(true);
    expect(tailB?.startsWith(b.signerFingerprint)).toBe(true);
  });

  it('each chain verifies ANONYMOUSLY — with only its own root, no key root', () => {
    foundAndWrite(openChainForWriting(chainA, { keyRoot }), 't-a');
    foundAndWrite(openChainForWriting(chainB, { keyRoot }), 't-b');

    // A verifier is handed only the chain root (a clone the team pulled); it has
    // no access to the key root, and must still verify green from the
    // materialized public key alone.
    const vA = verify(chainA);
    const vB = verify(chainB);
    expect(vA.ok).toBe(true);
    expect(vA.fullySigned).toBe(true);
    expect(vB.ok).toBe(true);
    expect(vB.fullySigned).toBe(true);
  });
});

describe('lifecycle — add a second chain later, with zero migration', () => {
  it('a solo chain, then a second one on the same key root, share one identity untouched', () => {
    // Solo: the person works in one chain first.
    const solo = openChainForWriting(chainA, { keyRoot });
    foundAndWrite(solo, 't-solo');
    const anchorBefore = solo.anchor;
    const fpBefore = solo.signerFingerprint;
    expect(verify(chainA).fullySigned).toBe(true);

    // Later: a second chain is added, referencing the SAME key root. Nothing in
    // the first chain is moved or rewritten — the key never left the key root,
    // so there is no migration. The second chain simply points at it.
    const second = openChainForWriting(chainB, { keyRoot });
    foundAndWrite(second, 't-second');

    // Same identity across both, and the first chain is still intact and signed.
    expect(second.anchor).toBe(anchorBefore);
    expect(second.signerFingerprint).toBe(fpBefore);
    expect(verify(chainA).fullySigned).toBe(true);
    expect(verify(chainB).fullySigned).toBe(true);
  });
});
