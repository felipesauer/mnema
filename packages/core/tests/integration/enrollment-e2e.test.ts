/**
 * Enrollment end to end through the core operations and the chain verifier.
 *
 * The chain-level enrollment tests build events by hand; this drives the real
 * core operations (foundIdentity / enrollKey / revokeKey) across two machines
 * with DISTINCT keys, merges their tails offline, and runs `verify` — the whole
 * mechanism the surface will sit on. It pins the flow the wave exists for: one
 * identity, several distinct keys, each proven by signature, with prospective
 * revocation.
 *
 * The between-machines UX (how machine B hands its fingerprint and reverse
 * signature to A) is a surface concern; here the test assembles that material
 * directly, the same way the mechanism is meant to be driven.
 */

import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainWriter,
  catalogUpcasters,
  enrollmentMessage,
  loadOrCreateKeyPair,
  openChainForWriting,
  sign,
  taskCreated,
  type UpcasterRegistry,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enrollKey, foundIdentity, revokeKey } from '../../src/workflow/identity-operations.js';
import type { WriteContext } from '../../src/workflow/operations.js';
import { createTask } from '../../src/workflow/operations.js';

/**
 * A machine: its own chain root and writer (a distinct key). Its `keyPair` is
 * pulled off disk so the test can produce the reverse signature B must make to
 * be enrolled — the material the surface would exchange between machines.
 */
interface Machine {
  readonly root: string;
  readonly writer: ChainWriter;
  readonly fingerprint: string;
}

let a: Machine;
let b: Machine;
const upcasters: UpcasterRegistry = catalogUpcasters();

function openMachine(prefix: string): Machine {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const writer = openChainForWriting(root);
  return { root, writer, fingerprint: writer.signerFingerprint };
}

function ctxOf(machine: Machine): WriteContext {
  return { writer: machine.writer, layout: { root: machine.root }, upcasters, clock };
}

let tick = 0;
const clock = () => {
  tick += 1;
  return `2026-07-21T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

beforeEach(() => {
  a = openMachine('mnema-e2e-a-');
  b = openMachine('mnema-e2e-b-');
  tick = 0;
});

afterEach(() => {
  rmSync(a.root, { recursive: true, force: true });
  rmSync(b.root, { recursive: true, force: true });
});

/** Produces the reverse signature a machine makes to prove it consents to join `anchor`. */
function reverseSigOf(anchor: string, machine: Machine): string {
  // The reverse signature needs the machine's private key; load it from that
  // machine's own keystore (the material a real enroll handshake would carry).
  const kp = loadOrCreateKeyPair({ root: machine.root });
  return Buffer.from(sign(enrollmentMessage(anchor, machine.fingerprint), kp.privateKey)).toString(
    'hex',
  );
}

/** Copies B's tail + committed public key into A's chain (an offline merge). */
function mergeIntoA(): void {
  cpSync(join(b.root, 'tails'), join(a.root, 'tails'), { recursive: true });
  for (const key of readdirSync(join(b.root, 'keys'))) {
    if (key.endsWith('.pub')) {
      cpSync(join(b.root, 'keys', key), join(a.root, 'keys', key));
    }
  }
}

describe('enrollment e2e — a distinct second key joins one anchor', () => {
  it('found → enroll B → B signs events under A’s anchor → verify green', () => {
    const ctxA = ctxOf(a);
    // A founds its anchor.
    const founded = foundIdentity(ctxA);
    expect(founded.ok).toBe(true);
    const anchor = founded.anchor;

    // B must serve A's anchor. In production B would learn it during the enroll
    // handshake; here the test records it on B directly, then B produces its
    // proof-of-possession over A's anchor.
    b.writer.recordAnchor(anchor);
    const rsig = reverseSigOf(anchor, b);

    // A enrolls B (vouches), supplying B's fingerprint and reverse signature.
    const enrolledOk = enrollKey(ctxA, { newFp: b.fingerprint, reverseSig: rsig });
    expect(enrolledOk.anchor).toBe(anchor);

    // B, now a member, authors a task under the SHARED anchor.
    b.writer.append(
      taskCreated(
        { at: clock(), who: anchor, signerFp: b.fingerprint, subject: 't-b' },
        { title: 'from B' },
      ),
    );

    mergeIntoA();
    const r = verify(a.root);
    expect(r.ok).toBe(true);
    // Two tails (A and B), one identity.
    expect(r.tails).toHaveLength(2);
  });
});

describe('enrollment e2e — prospective revocation', () => {
  it('revoke B → B’s later events are rejected, its earlier ones stay valid', () => {
    const ctxA = ctxOf(a);
    const anchor = foundIdentity(ctxA).anchor;
    b.writer.recordAnchor(anchor);
    enrollKey(ctxA, { newFp: b.fingerprint, reverseSig: reverseSigOf(anchor, b) });

    // B writes a task WHILE a member.
    b.writer.append(
      taskCreated(
        { at: clock(), who: anchor, signerFp: b.fingerprint, subject: 't-before' },
        { title: 'before revoke' },
      ),
    );

    // A revokes B.
    revokeKey(ctxA, { revokedFp: b.fingerprint, reason: 'key rotated out' });

    // B writes AGAIN, now revoked — this event must be rejected.
    b.writer.append(
      taskCreated(
        { at: clock(), who: anchor, signerFp: b.fingerprint, subject: 't-after' },
        { title: 'after revoke' },
      ),
    );

    mergeIntoA();
    const r = verify(a.root);
    expect(r.ok).toBe(false);
    // Exactly one enrollment failure: the post-revocation task.
    const failures = r.issues.filter((i) => /not a key enrolled/.test(i.detail));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.tail.startsWith(b.fingerprint)).toBe(true);
  });
});

describe('enrollment e2e — the core founds on first use', () => {
  it('a plain createTask founds the anchor implicitly and verifies green', () => {
    const ctxA = ctxOf(a);
    // No explicit foundIdentity — createTask must found on first use.
    const created = createTask(ctxA, { id: 't-1', title: 'ship', which: 'claude' });
    expect(created.ok).toBe(true);
    a.writer.checkpoint();
    const r = verify(a.root);
    expect(r.ok).toBe(true);
    expect(r.fullySigned).toBe(true);
  });
});
