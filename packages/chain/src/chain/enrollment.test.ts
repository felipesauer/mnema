/**
 * Identity by enrollment, end to end through the verifier.
 *
 * These build real Ed25519 keys and real chains on disk, then run `verify` — the
 * same path an anonymous clone runs. They pin the single identity rule (an event
 * is authentic only if its signer is a key valid for its anchor at its point),
 * the three enrollment facts, the reverse-signature proof-of-possession, and the
 * attacks the fold must reject.
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enrollmentMessage,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  taskCreated,
} from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { verify } from './chain.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem, sign } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir } from './layout.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-enroll-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const AT = '2026-07-21T00:00:00.000Z';

/** Writes a key pair's committed public key into the chain's roster. */
function commitPublicKey(kp: KeyPair): void {
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
}

/**
 * Writes a tail directory named `<fp>-<suffix>` holding `events` in order,
 * hash-chained, and signs one checkpoint over the whole tail with `signer`.
 * Every helper below composes chains out of this, so a tail is always a real
 * sealed, checkpointed artifact — the shape verify actually reads.
 */
function writeTail(
  tailId: string,
  events: readonly CatalogEvent[],
  signer: KeyPair,
  opts: { checkpoint?: boolean } = {},
): void {
  const dir = tailDir({ root }, tailId);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  let prev: string | null = null;
  for (let seq = 0; seq < events.length; seq += 1) {
    const event = events[seq] as CatalogEvent;
    const hash = entryHash({ event, tail: tailId, seq, prev });
    lines.push(
      canonicalStringify({ event: event as never, link: { tail: tailId, seq, prev, hash } }),
    );
    prev = hash;
  }
  writeFileSync(segmentPath({ root }, tailId, 1), `${lines.join('\n')}\n`);
  if (opts.checkpoint !== false) {
    const cp = signCheckpoint({ tail: tailId, fromSeq: 0, events, prev: null, keyPair: signer });
    appendFileSync(checkpointsPath({ root }, tailId), `${serializeCheckpoint(cp)}\n`);
  }
}

/** The `identity.founded` a key signs for its own anchor. */
function founding(kp: KeyPair): CatalogEvent {
  const anchor = deriveAnchor(kp.fingerprint);
  return identityFounded(
    { at: AT, who: anchor, signerFp: kp.fingerprint, subject: anchor },
    { foundingFp: kp.fingerprint },
  );
}

/** The reverse signature `newKp` makes to prove it consents to joining `anchor`. */
function reverseSig(anchor: string, newKp: KeyPair): string {
  return Buffer.from(sign(enrollmentMessage(anchor, newKp.fingerprint), newKp.privateKey)).toString(
    'hex',
  );
}

/** A `key.enrolled` where `voucher` (already a member) brings in `newKp`. */
function enrolled(anchor: string, voucher: KeyPair, newKp: KeyPair): CatalogEvent {
  return keyEnrolled(
    { at: AT, who: anchor, signerFp: voucher.fingerprint, subject: anchor },
    { newFp: newKp.fingerprint, reverseSig: reverseSig(anchor, newKp) },
  );
}

/** A task authored by `signer` under `anchor`. */
function task(anchor: string, signer: KeyPair, id: string): CatalogEvent {
  return taskCreated(
    { at: AT, who: anchor, signerFp: signer.fingerprint, subject: id },
    {
      title: id,
    },
  );
}

describe('enrollment — the solo founder', () => {
  it('a founded solo key verifies green (one-member anchor)', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), task(anchor, kp, 't-1')], kp);
    const r = verify(root);
    expect(r.ok).toBe(true);
    expect(r.fullySigned).toBe(true);
  });

  it('an UNFOUNDED key writing events is rejected (the single rule bites)', () => {
    // No identity.founded → the key is not enrolled for its own anchor, so its
    // events fail membership. This is the degenerate mode made explicit: identity
    // is never assumed from the key, it is founded on the chain.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(`${kp.fingerprint}-i1`, [task(anchor, kp, 't-1')], kp);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /not a key enrolled/.test(i.detail))).toBe(true);
  });

  it('rejects a founding whose subject is not the anchor derived from the key', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const wrongAnchor = deriveAnchor('deadbeef');
    const bad = identityFounded(
      { at: AT, who: wrongAnchor, signerFp: kp.fingerprint, subject: wrongAnchor },
      { foundingFp: kp.fingerprint },
    );
    writeTail(`${kp.fingerprint}-i1`, [bad], kp);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /subject is not the anchor derived/.test(i.detail))).toBe(true);
  });

  it('rejects a founding that is not self-signed by its founding key', () => {
    const kp = generateKeyPair();
    const other = generateKeyPair();
    commitPublicKey(kp);
    commitPublicKey(other);
    const anchor = deriveAnchor(kp.fingerprint);
    // signerFp is `other`, but foundingFp claims kp — not self-signed.
    const bad = identityFounded(
      { at: AT, who: anchor, signerFp: other.fingerprint, subject: anchor },
      { foundingFp: kp.fingerprint },
    );
    writeTail(`${other.fingerprint}-i1`, [bad], other);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /not self-signed/.test(i.detail))).toBe(true);
  });
});

describe('enrollment — a distinct key joins one anchor (scenario 1)', () => {
  // B's task must come AFTER its enrollment in the fold order. In practice `at`
  // orders them — B can only write once A has enrolled it — so these use
  // increasing timestamps, the realistic case. (A caveat, documented in
  // enrollment.ts: when two tails share an identical `at`, the deterministic
  // tie-break is by tail id, which does not encode causality; production stamps
  // a monotonic `at`, so an enroll precedes the events that depend on it.)
  const atFound = '2026-07-21T00:00:01.000Z';
  const atEnroll = '2026-07-21T00:00:02.000Z';
  const atTaskB = '2026-07-21T00:00:03.000Z';

  function chainWithEnrolledB(): { a: KeyPair; b: KeyPair; anchor: string } {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const foundE = identityFounded(
      { at: atFound, who: anchor, signerFp: a.fingerprint, subject: anchor },
      { foundingFp: a.fingerprint },
    );
    const enrollE = keyEnrolled(
      { at: atEnroll, who: anchor, signerFp: a.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
    );
    const taskB = taskCreated(
      { at: atTaskB, who: anchor, signerFp: b.fingerprint, subject: 't-b' },
      { title: 'from b' },
    );
    writeTail(`${a.fingerprint}-i1`, [foundE, enrollE], a);
    writeTail(`${b.fingerprint}-i1`, [taskB], b);
    return { a, b, anchor };
  }

  it('key B, enrolled by A, authors events under A’s anchor and verifies green', () => {
    chainWithEnrolledB();
    const r = verify(root);
    expect(r.ok).toBe(true);
    expect(r.fullySigned).toBe(true);
    expect(r.tails).toHaveLength(2);
  });

  it('the OLD rule would have rejected B: its who is A’s anchor, not deriveAnchor(B)', () => {
    // This is the whole point of the change. B's events carry who = A's anchor,
    // which is NOT deriveAnchor(B.fingerprint); the pre-enrollment check would
    // have failed them. Enrollment is what makes one identity span two keys.
    const { anchor, b } = chainWithEnrolledB();
    expect(anchor).not.toBe(deriveAnchor(b.fingerprint));
    expect(verify(root).ok).toBe(true);
  });
});

describe('enrollment — an unenrolled attacker is rejected (scenario 2)', () => {
  it('a stranger key authoring events under an anchor it never joined is rejected', () => {
    const a = generateKeyPair();
    const evil = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(evil);
    const anchor = deriveAnchor(a.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a)], a);
    // The attacker commits their key and writes a task claiming A's anchor.
    writeTail(`${evil.fingerprint}-i1`, [task(anchor, evil, 't-evil')], evil);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /not a key enrolled/.test(i.detail))).toBe(true);
  });

  it('a stranger cannot self-enroll: key.enrolled signed by a non-member is rejected', () => {
    const a = generateKeyPair();
    const evil = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(evil);
    const anchor = deriveAnchor(a.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a)], a);
    // evil signs a key.enrolled for itself, with a valid reverse-sig — but evil
    // is not a member, so the voucher check fails.
    const selfEnroll = keyEnrolled(
      { at: AT, who: anchor, signerFp: evil.fingerprint, subject: anchor },
      { newFp: evil.fingerprint, reverseSig: reverseSig(anchor, evil) },
    );
    writeTail(`${evil.fingerprint}-i1`, [selfEnroll, task(anchor, evil, 't-evil')], evil);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /signed by a key not valid for the anchor/.test(i.detail))).toBe(
      true,
    );
  });
});

describe('enrollment — the reverse signature proves possession (replay closed)', () => {
  it('rejects an enrollment whose reverse-sig is for a DIFFERENT anchor (replay)', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const otherAnchor = deriveAnchor('cafe'.repeat(16));
    // B signed possession for otherAnchor, but the event enrolls into anchor.
    const forged = keyEnrolled(
      { at: AT, who: anchor, signerFp: a.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(otherAnchor, b) },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), forged], a);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /reverse signature does not prove possession/.test(i.detail))).toBe(
      true,
    );
  });

  it('rejects an enrollment whose reverse-sig is by a DIFFERENT key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const c = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    commitPublicKey(c);
    const anchor = deriveAnchor(a.fingerprint);
    // The reverse-sig is C's, but the event claims to enroll B: C cannot consent
    // for B, and B's committed key does not verify C's signature.
    const forged = keyEnrolled(
      { at: AT, who: anchor, signerFp: a.fingerprint, subject: anchor },
      {
        newFp: b.fingerprint,
        reverseSig: Buffer.from(
          sign(enrollmentMessage(anchor, b.fingerprint), c.privateKey),
        ).toString('hex'),
      },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), forged], a);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /reverse signature does not prove possession/.test(i.detail))).toBe(
      true,
    );
  });

  it('rejects an enrollment for a key with no committed public key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    // B's public key is NOT committed, so possession cannot be checked.
    const anchor = deriveAnchor(a.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolled(anchor, a, b)], a);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /reverse signature does not prove possession/.test(i.detail))).toBe(
      true,
    );
  });
});

describe('enrollment — revocation is prospective (scenario 3)', () => {
  it('events a key signed BEFORE its revocation stay valid; AFTER are rejected', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);

    // Order by `at` (the fold's order): found, enroll B, B writes t-before,
    // A revokes B, B writes t-after. Use increasing timestamps so the total
    // order is unambiguous across the two tails.
    const foundE = identityFounded(
      { at: '2026-07-21T00:00:01.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { foundingFp: a.fingerprint },
    );
    const enrollE = keyEnrolled(
      { at: '2026-07-21T00:00:02.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
    );
    const beforeE = taskCreated(
      { at: '2026-07-21T00:00:03.000Z', who: anchor, signerFp: b.fingerprint, subject: 't-before' },
      { title: 'before' },
    );
    const revokeE = keyRevoked(
      { at: '2026-07-21T00:00:04.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'rotated' },
    );
    const afterE = taskCreated(
      { at: '2026-07-21T00:00:05.000Z', who: anchor, signerFp: b.fingerprint, subject: 't-after' },
      { title: 'after' },
    );

    writeTail(`${a.fingerprint}-i1`, [foundE, enrollE, revokeE], a);
    writeTail(`${b.fingerprint}-i1`, [beforeE, afterE], b);

    const r = verify(root);
    expect(r.ok).toBe(false);
    // The AFTER task is rejected (b no longer valid); the BEFORE task is not.
    const enrollmentIssues = r.issues.filter((i) => /not a key enrolled/.test(i.detail));
    expect(enrollmentIssues).toHaveLength(1);
    expect(enrollmentIssues[0]?.seq).toBe(1); // t-after is seq 1 in b's tail
  });

  it('a revoked key cannot re-enroll ITSELF afterward', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const foundE = identityFounded(
      { at: '2026-07-21T00:00:01.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { foundingFp: a.fingerprint },
    );
    const enrollB = keyEnrolled(
      { at: '2026-07-21T00:00:02.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
    );
    const revokeB = keyRevoked(
      { at: '2026-07-21T00:00:03.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'gone' },
    );
    // B, now revoked, tries to re-enroll itself. It is no longer a valid member,
    // so the voucher check on its own key.enrolled fails.
    const reenroll = keyEnrolled(
      { at: '2026-07-21T00:00:04.000Z', who: anchor, signerFp: b.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
    );
    writeTail(`${a.fingerprint}-i1`, [foundE, enrollB, revokeB], a);
    writeTail(`${b.fingerprint}-i1`, [reenroll], b);
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /signed by a key not valid for the anchor/.test(i.detail))).toBe(
      true,
    );
  });

  it('a peer can revoke the founder (revocation is by peers, no hierarchy)', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const foundE = identityFounded(
      { at: '2026-07-21T00:00:01.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { foundingFp: a.fingerprint },
    );
    const enrollB = keyEnrolled(
      { at: '2026-07-21T00:00:02.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
    );
    // B revokes the FOUNDER A. Then A tries to write — rejected; B still writes.
    const revokeA = keyRevoked(
      { at: '2026-07-21T00:00:03.000Z', who: anchor, signerFp: b.fingerprint, subject: anchor },
      { revokedFp: a.fingerprint, reason: 'founder key retired' },
    );
    const aAfter = taskCreated(
      { at: '2026-07-21T00:00:04.000Z', who: anchor, signerFp: a.fingerprint, subject: 't-a' },
      { title: 'a after revoke' },
    );
    const bAfter = taskCreated(
      { at: '2026-07-21T00:00:05.000Z', who: anchor, signerFp: b.fingerprint, subject: 't-b' },
      { title: 'b after revoke' },
    );
    writeTail(`${a.fingerprint}-i1`, [foundE, enrollB, aAfter], a);
    writeTail(`${b.fingerprint}-i1`, [revokeA, bAfter], b);
    const r = verify(root);
    expect(r.ok).toBe(false);
    const enrollmentIssues = r.issues.filter((i) => /not a key enrolled/.test(i.detail));
    // Only A's post-revocation task is rejected; B's remains valid.
    expect(enrollmentIssues).toHaveLength(1);
    expect(enrollmentIssues[0]?.tail).toBe(`${a.fingerprint}-i1`);
  });
});

describe('enrollment — a residual revocation cannot invalidate an honest signed chain', () => {
  it('a keyless residual key.revoked on a fabricated real-fp tail does NOT flip an honest chain', () => {
    // The denial vector: a keyless party fabricates a tail named by a REAL
    // enrolled fingerprint (permitted in the residual window) and plants an
    // UNCHECKPOINTED key.revoked of another member, timed before that member's
    // signed events, trying to make the honest, fully-signed chain fail. Because
    // a revocation takes effect only when signature-covered — and a keyless party
    // cannot checkpoint a fabricated tail — the residual revoke is ignored.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const t = (n: number) => `2026-07-21T00:00:0${n}.000Z`;

    // Honest, fully-signed victim chain: A founds, enrolls B, and later A writes
    // a task — all in one checkpointed tail.
    writeTail(
      `${a.fingerprint}-i1`,
      [
        identityFounded(
          { at: t(1), who: anchor, signerFp: a.fingerprint, subject: anchor },
          { foundingFp: a.fingerprint },
        ),
        keyEnrolled(
          { at: t(2), who: anchor, signerFp: a.fingerprint, subject: anchor },
          { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
        ),
        taskCreated(
          { at: t(5), who: anchor, signerFp: a.fingerprint, subject: 't-a' },
          { title: 'a task' },
        ),
      ],
      a,
    );
    expect(verify(root).ok).toBe(true);

    // Attacker: fabricated tail under B's REAL fingerprint, one RESIDUAL revoke
    // of A timed (t3) between B's enrollment and A's task — NO checkpoint.
    writeTail(
      `${b.fingerprint}-attacker`,
      [
        keyRevoked(
          { at: t(3), who: anchor, signerFp: b.fingerprint, subject: anchor },
          { revokedFp: a.fingerprint, reason: 'evil' },
        ),
      ],
      b,
      { checkpoint: false },
    );

    // The honest chain stays green: the residual revoke never removed A.
    const r = verify(root);
    expect(r.ok).toBe(true);
  });

  it('a CHECKPOINTED revocation still takes effect (the gate does not disable honest revokes)', () => {
    // The contrast: the same revoke, but signature-covered, DOES remove the key.
    // A can only checkpoint its own tail with its own key, so this is the honest
    // path — a member revoking another and signing the revocation.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const t = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
    writeTail(
      `${a.fingerprint}-i1`,
      [
        identityFounded(
          { at: t(1), who: anchor, signerFp: a.fingerprint, subject: anchor },
          { foundingFp: a.fingerprint },
        ),
        keyEnrolled(
          { at: t(2), who: anchor, signerFp: a.fingerprint, subject: anchor },
          { newFp: b.fingerprint, reverseSig: reverseSig(anchor, b) },
        ),
        keyRevoked(
          { at: t(3), who: anchor, signerFp: a.fingerprint, subject: anchor },
          { revokedFp: b.fingerprint, reason: 'rotated' },
        ),
      ],
      a,
    );
    // B writes AFTER its checkpointed revocation — rejected.
    writeTail(
      `${b.fingerprint}-i1`,
      [
        taskCreated(
          { at: t(4), who: anchor, signerFp: b.fingerprint, subject: 't-after' },
          { title: 'after revoke' },
        ),
      ],
      b,
    );
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /not a key enrolled/.test(i.detail))).toBe(true);
  });
});

describe('enrollment — the residual-dup and HOLE#1 vectors', () => {
  it('rejects a fabricated tail whose fingerprint is NOT enrolled (HOLE#1 stays shut)', () => {
    // A keyless attacker fabricates a tail named by an uncommitted fingerprint
    // and stuffs events in it. Two guards fire: the tail-prefix guard (no
    // committed key) AND the enrollment fold (the fp is not enrolled).
    const a = generateKeyPair();
    commitPublicKey(a);
    const anchor = deriveAnchor(a.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), task(anchor, a, 't-1')], a);
    // Fabricated tail: an uncommitted fingerprint prefix, events claiming A's anchor.
    const fakeFp = 'f'.repeat(64);
    writeTail(`${fakeFp}-evil`, [task(anchor, a, 't-dup')], a, { checkpoint: false });
    const r = verify(root);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /no committed key fingerprint/.test(i.detail))).toBe(true);
  });
});
