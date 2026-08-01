/**
 * The three roster verbs as adapters — `key request`, `key enroll`, `key revoke`.
 *
 * What is pinned here is the SEAM, not the mechanism: which of them needs a
 * project and which does not, that a relative path means what the person typed it
 * to mean, and that a refusal reaches them in the core's own words rather than one
 * the surface invented. The mechanism (a key joins, the joining machine then
 * writes as that identity) is pinned in the core's suite and end to end through
 * the real CLI.
 *
 * The asymmetry across the three is the design, and it is asserted: a request runs
 * where the key wants IN and touches only the key root, while a vouch and a
 * retirement are facts in the committed record — so only the last two refuse
 * without a project.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, listPrivateKeyFingerprints } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runKeyEnroll } from './key-enroll.js';
import { runKeyRequest } from './key-request.js';
import { runKeyRevoke } from './key-revoke.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-key-roster-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A machine: its own data dir (so its own key root), sharing one repo. */
interface Machine {
  readonly env: DiscoveryEnv;
  readonly keyRoot: string;
}

function machine(name: string): Machine {
  const env = { xdgDataHome: join(sandbox, name, 'data'), home: join(sandbox, name, 'home') };
  return { env, keyRoot: join(sandbox, name, 'data', 'mnema', 'identity') };
}

function repo(): string {
  const dir = join(sandbox, 'repo');
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('key request — the joining machine, and no project needed', () => {
  it('produces a request from an empty machine OUTSIDE any project', () => {
    // Nothing about a request is per-tree: it is a key and a signature over fixed
    // values. Requiring a project would block the case it exists for.
    const b = machine('b');
    const anchor = `mnid:${'a'.repeat(64)}`;
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });

    const made = runKeyRequest({ cwd: nowhere, env: b.env }, { anchor });

    expect(made).toMatchObject({ ok: true, anchor, source: 'machine', minted: true });
    expect((made as { request: string }).request.startsWith('mnema-key-request:1:')).toBe(true);
    expect(listPrivateKeyFingerprints({ root: b.keyRoot })).toEqual([
      (made as { fingerprint: string }).fingerprint,
    ]);
  });

  it('resolves a RELATIVE --key path against the injected cwd', () => {
    const b = machine('b');
    const work = join(sandbox, 'work');
    mkdirSync(work, { recursive: true });
    const cold = generateKeyPair();
    writeFileSync(
      join(work, 'cold.key'),
      cold.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );

    const made = runKeyRequest(
      { cwd: work, env: b.env },
      { anchor: `mnid:${'b'.repeat(64)}`, privateKeyPath: 'cold.key' },
    );

    expect(made).toMatchObject({ ok: true, source: 'file', fingerprint: cold.fingerprint });
    // Read, never installed: the key root stays empty.
    expect(listPrivateKeyFingerprints({ root: b.keyRoot })).toEqual([]);
  });

  it('refuses a value that names no identity, and says what one looks like', () => {
    // From a machine with no record, a prefix has nothing to resolve against — so
    // the sentence teaches the SHAPE rather than listing an empty set, and nothing
    // is signed. The core keeps the same check at the write boundary (see
    // `requestEnrollment`), which is what guarantees no signature is ever made over
    // half an identity; this is the surface saying it where the person can act.
    const b = machine('b');
    const refused = runKeyRequest({ cwd: sandbox, env: b.env }, { anchor: 'not-an-anchor' });

    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ANCHOR' });
    const message = (refused as { message: string }).message;
    expect(message).toContain('not-an-anchor');
    expect(message).toContain('64 hex');
  });
});

describe('key enroll — a member vouches, in the committed record', () => {
  it("enrolls the requesting key into this machine's identity", () => {
    const a = machine('a');
    const b = machine('b');
    const project = repo();
    const anchor = runInit({ cwd: project, env: a.env }).anchor;
    const request = (runKeyRequest({ cwd: project, env: b.env }, { anchor }) as { request: string })
      .request;

    const enrolled = runKeyEnroll({ cwd: project, env: a.env }, { request });

    expect(enrolled).toMatchObject({
      ok: true,
      anchor,
      alreadyMember: false,
      root: join(project, '.mnema'),
    });
  });

  it('refuses NO_PROJECT outside a project — a vouch is a fact in a record', () => {
    const a = machine('a');
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });

    expect(runKeyEnroll({ cwd: orphan, env: a.env }, { request: 'anything' })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });

  it("forwards the core's refusal verbatim, for a request made elsewhere", () => {
    const a = machine('a');
    const b = machine('b');
    const project = repo();
    runInit({ cwd: project, env: a.env });
    // B asked to join some OTHER identity, so its consent does not cover this one.
    const request = (
      runKeyRequest({ cwd: project, env: b.env }, { anchor: `mnid:${'c'.repeat(64)}` }) as {
        request: string;
      }
    ).request;

    const refused = runKeyEnroll({ cwd: project, env: a.env }, { request });

    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNPROVEN_REQUEST' });
  });
});

describe('key revoke — a retirement, in the committed record', () => {
  it('retires an enrolled key and reports what is left', () => {
    const a = machine('a');
    const b = machine('b');
    const project = repo();
    const anchor = runInit({ cwd: project, env: a.env }).anchor;
    const request = (runKeyRequest({ cwd: project, env: b.env }, { anchor }) as { request: string })
      .request;
    const joined = runKeyEnroll({ cwd: project, env: a.env }, { request }) as {
      fingerprint: string;
    };

    const revoked = runKeyRevoke(
      { cwd: project, env: a.env },
      { fingerprint: joined.fingerprint, reason: 'that laptop was sold' },
    );

    // Two keys were left after the enrollment (the machine's own and the backup),
    // so retiring the joined one leaves those two.
    expect(revoked).toMatchObject({
      ok: true,
      anchor,
      fingerprint: joined.fingerprint,
      self: false,
      remaining: 2,
    });
  });

  it('reports `self` when the retired key is the one this machine signs with', () => {
    const a = machine('a');
    const project = repo();
    runInit({ cwd: project, env: a.env });
    const own = listPrivateKeyFingerprints({ root: a.keyRoot })[0] as string;

    const revoked = runKeyRevoke(
      { cwd: project, env: a.env },
      { fingerprint: own, reason: 'decommissioning this machine' },
    );

    // The backup key is a member too, so this is allowed — and the caller has to be
    // told it just retired the key it writes with.
    expect(revoked).toMatchObject({ ok: true, self: true, remaining: 1 });
  });

  it('refuses NO_PROJECT outside a project, and forwards the core refusal inside one', () => {
    const a = machine('a');
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    expect(
      runKeyRevoke({ cwd: orphan, env: a.env }, { fingerprint: 'x'.repeat(64), reason: 'why' }),
    ).toEqual({ ok: false, reason: 'NO_PROJECT' });

    const project = repo();
    runInit({ cwd: project, env: a.env });
    const refused = runKeyRevoke(
      { cwd: project, env: a.env },
      { fingerprint: 'd'.repeat(64), reason: 'never seen it' },
    );
    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_KEY' });
  });
});

describe('the three verbs together — a second machine joins and writes as one identity', () => {
  it('request → enroll → the joining machine reads back the identity it joined', () => {
    const a = machine('a');
    const b = machine('b');
    const project = repo();
    const anchor = runInit({ cwd: project, env: a.env }).anchor;

    const request = (runKeyRequest({ cwd: project, env: b.env }, { anchor }) as { request: string })
      .request;
    expect(runKeyEnroll({ cwd: project, env: a.env }, { request }).ok).toBe(true);

    // The joining machine learns it was accepted by READING the record: its local
    // anchor for this tree is only written when it first writes there.
    const tree = join(project, '.mnema');
    const bFp = listPrivateKeyFingerprints({ root: b.keyRoot })[0] as string;
    expect(runKeyRequest({ cwd: project, env: b.env }, { anchor })).toMatchObject({
      fingerprint: bFp,
      minted: false,
    });
    // The vouch committed B's public half into the tree — the material the consent
    // is proven against, and what an anonymous verifier reads.
    expect(readFileSync(join(tree, 'keys', `${bFp}.pub`), 'utf-8')).toContain('PUBLIC KEY');
  });
});
