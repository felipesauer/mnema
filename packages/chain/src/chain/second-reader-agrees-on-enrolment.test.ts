/**
 * THE TWO READERS OVER RECORDS THIS PRODUCT WROTE — and the question is not the one
 * the mutation table asks.
 *
 * The mutation table asks *does the second reader refuse what the product refuses*, and
 * it is answered by building attacks. This file asks the other half, which is the one
 * nobody goes looking for: **does it refuse anything the product ACCEPTS?**
 *
 * Refusing too much is the quieter of the two failures, because it looks like rigour. It
 * happened here, and it is why this file exists. With no field declarations published, the
 * only derivation of the envelope a stranger could make was the INTERSECTION of the
 * published vectors' top-level keys — which `FORMAT.md` section 7 stated as a fact, in so
 * many words. `which` is carried by sixteen of the twenty-three vectors and `run` by
 * three, so an intersection is not the envelope; the second reader consequently REFUSED an
 * honest event for carrying `which`, on a record the product read as fine. Nothing caught
 * it: the frozen records happen to hold only events that carry neither, and every mutation
 * in the table is an attack, so every case in the suite was asking the other question.
 * Gap G25.
 *
 * SECTION 6.2 IS THE OTHER HALF, and it is the one with room to be over-strict. Enrolment
 * is a FOLD — an order across tails, a set that grows and shrinks, and two gates that turn
 * on signature coverage — so a reader that got any of that slightly wrong would refuse
 * honest records rather than accept forged ones. So the scenarios below are the product's
 * own enrolment cases, written to disk through the product's builders and keys, and the
 * two readers have to reach the same POLARITY on every one: green where the product is
 * green, refused where it refuses.
 *
 * EVERY RECORD HERE IS BUILT, NOT FROZEN. The frozen fixtures are one anchor with one
 * writing key; nothing in them exercises a second key authoring under the first's anchor,
 * a revocation, or a replayed reverse signature. A differential test over data that cannot
 * reach the branches is a differential test over nothing.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash, writtenAsBuilt } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem, sign } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir, tailProofPath } from './layout.js';
import { serializeTailProof, signTailProof } from './tailproof.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-two-readers-enrol-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface SecondReading {
  readonly verdict: string;
  readonly findings: readonly {
    readonly level: string;
    readonly section: string;
    readonly what: string;
    readonly where: string;
  }[];
}

function secondReading(record: string): SecondReading {
  const run = spawnSync('python3', [VERIFIER, '--json', 'record', record], { encoding: 'utf-8' });
  if (run.stdout === '') {
    throw new Error(`the second reader produced no verdict. stderr: ${run.stderr}`);
  }
  return JSON.parse(run.stdout) as SecondReading;
}

function refusals(reading: SecondReading): readonly string[] {
  return reading.findings
    .filter((f) => f.level === 'FAIL')
    .map((f) => `${f.section}: ${f.what} (${f.where})`);
}

function commitPublicKey(kp: KeyPair): void {
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
}

/**
 * One tail, hash-chained, with its birth proof and one checkpoint.
 *
 * `residual` leaves that many trailing events OUT of the checkpoint — the window a party
 * with no key can write in, and the only way to reach section 6.2's two gates.
 * `breakSignature` corrupts the checkpoint's `sig`, which is how a checkpoint that CLAIMS a
 * range without proving it is built: coverage is what a verified checkpoint reaches, not
 * what one says it does.
 */
function writeTail(
  tailId: string,
  events: readonly CatalogEvent[],
  signer: KeyPair,
  opts: { residual?: number; breakSignature?: boolean } = {},
): void {
  const dir = tailDir({ root }, tailId);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  let prev: string | null = null;
  for (let seq = 0; seq < events.length; seq += 1) {
    const event = events[seq] as CatalogEvent;
    const hash = entryHash({ event: writtenAsBuilt(event), tail: tailId, seq, prev });
    lines.push(
      canonicalStringify({ event: event as never, link: { tail: tailId, seq, prev, hash } }),
    );
    prev = hash;
  }
  writeFileSync(segmentPath({ root }, tailId, 1), `${lines.join('\n')}\n`);
  writeFileSync(
    tailProofPath({ root }, tailId),
    `${serializeTailProof(signTailProof(tailId, signer))}\n`,
  );
  const covered = events.slice(0, events.length - (opts.residual ?? 0));
  if (covered.length === 0) return;
  const cp = signCheckpoint({
    tail: tailId,
    fromSeq: 0,
    events: covered.map(writtenAsBuilt),
    prev: null,
    keyPair: signer,
  });
  const line = opts.breakSignature
    ? serializeCheckpoint({ ...cp, sig: `${'0'.repeat(127)}1` })
    : serializeCheckpoint(cp);
  appendFileSync(checkpointsPath({ root }, tailId), `${line}\n`);
}

const at = (n: number): string => `2026-07-21T00:00:0${n}.000Z`;

function founding(kp: KeyPair): CatalogEvent {
  const anchor = deriveAnchor(kp.fingerprint);
  return identityFounded(
    { at: at(1), who: anchor, signerFp: kp.fingerprint, subject: anchor },
    { foundingFp: kp.fingerprint },
  );
}

function reverseSig(anchor: string, newKp: KeyPair): string {
  return Buffer.from(sign(enrollmentMessage(anchor, newKp.fingerprint), newKp.privateKey)).toString(
    'hex',
  );
}

function enrolled(anchor: string, voucher: KeyPair, newKp: KeyPair, when = 2): CatalogEvent {
  return keyEnrolled(
    { at: at(when), who: anchor, signerFp: voucher.fingerprint, subject: anchor },
    { newFp: newKp.fingerprint, reverseSig: reverseSig(anchor, newKp) },
  );
}

function task(
  anchor: string,
  signer: KeyPair,
  id: string,
  when = 3,
  extra: { which?: string; run?: string } = {},
): CatalogEvent {
  return taskCreated(
    { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: id, ...extra },
    { title: id },
  );
}

/**
 * One scenario: build a record, and require the two readers to agree on its POLARITY.
 *
 * Polarity and not the whole verdict, because the two word themselves differently on
 * purpose and `FORMAT.md` disclaims the wording ("this document specifies the bytes, not
 * … what a verifier's verdict means"). What it does not disclaim is whether a record is
 * refused, and that is what is asserted — in BOTH directions, so a reader that refused
 * everything would fail here just as loudly as one that refused nothing.
 */
function bothReaders(): { productOk: boolean; verdict: string; refused: readonly string[] } {
  const here = verify(root, catalogUpcasters());
  const there = secondReading(root);
  return { productOk: here.ok, verdict: there.verdict, refused: refusals(there) };
}

describe('the two readers agree on records the product itself wrote — enrolment', () => {
  it('a founded solo key: green on both, and the second reader says WHY it is green', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), task(anchor, kp, 't-1')], kp);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(true);
    expect(refused).toEqual([]);
    expect(verdict).toBe('VERIFIED');
    // NON-VACUITY OF THE PASS: a reader that had simply not run the fold would also refuse
    // nothing here, so the finding that says it ran is asserted rather than the absence.
    const said = secondReading(root)
      .findings.filter((f) => f.level === 'ok')
      .map((f) => `${f.section} ${f.what}`)
      .join('\n');
    expect(said).toContain('VALID FOR ITS ANCHOR');
  });

  it('an honest event carrying `which` and `run`: green on both — the over-refusal, gone', () => {
    // GAP G25, AS A RECORD. Before the declarations were published, the second reader
    // derived the envelope by intersecting the vectors and REFUSED this, on bytes the
    // product reads as fine. Nothing in the suite could catch it: the frozen fixtures carry
    // no event with either field, and every other case is an attack.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), task(anchor, kp, 't-1', 3, { which: 'claude', run: 'r-1' })],
      kp,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest optional envelope field').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a second key, enrolled by the first, authoring under the first’s anchor: green on both', () => {
    // The case that needs the FOLD rather than a per-event check: B's signer is not B's
    // own anchor, and nothing but replaying the enrolment in order makes it valid.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolled(anchor, a, b)], a);
    writeTail(`${b.fingerprint}-i2`, [task(anchor, b, 't-1')], b);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('an UNFOUNDED key writing events: refused by both', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    writeTail(`${kp.fingerprint}-i1`, [task(deriveAnchor(kp.fingerprint), kp, 't-1')], kp);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('not a key enrolled');
  });

  it('a stranger self-enrolling: refused by both, and both name the voucher', () => {
    const a = generateKeyPair();
    const stranger = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(stranger);
    const anchor = deriveAnchor(a.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a)], a);
    writeTail(`${stranger.fingerprint}-i2`, [enrolled(anchor, stranger, stranger)], stranger);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('not valid for the anchor at this point');
  });

  it('a reverse signature replayed from another anchor: refused by both', () => {
    // The proof of possession is over `enroll:<anchor>:<newFp>`, so a signature the new key
    // made for a DIFFERENT anchor does not carry across — which is only checkable by a
    // reader that knows the message, and section 6.2 is where that message is written.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const forged = keyEnrolled(
      { at: at(2), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { newFp: b.fingerprint, reverseSig: reverseSig(deriveAnchor('deadbeef'), b) },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), forged], a);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('reverse signature does not prove possession');
  });

  it('a revocation is prospective: before stays, after is refused — by both', () => {
    // The one scenario where the two readers could disagree by an OFF-BY-ONE and nothing
    // else would show it: a fold that removed the key one event early would refuse `t-1`,
    // and a fold that removed it one late would accept `t-2`.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    //
    // B'S EVENTS LIVE IN B'S OWN TAIL, and that is a constraint of the format rather than a
    // convenience: a checkpoint requires every event in its range to name the signer that
    // attested it, so one tail cannot hold two keys' work under one checkpoint. Writing all
    // five into A's tail refuses at seq 2 for that reason instead, which would have made
    // this case pass while measuring the wrong thing entirely.
    const revoke = keyRevoked(
      { at: at(4), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'rotation' },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolled(anchor, a, b), revoke], a);
    writeTail(`${b.fingerprint}-i2`, [task(anchor, b, 't-1', 3), task(anchor, b, 't-2', 5)], b);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    // EXACTLY ONE event is refused, and it is the one after the revocation. A count is the
    // assertion here rather than a substring, because "refuses too much" is the failure
    // this file exists for and a substring cannot see it.
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('not a key enrolled');
    expect(refused[0], 'the refusal has to be B’s SECOND event, not its first').toContain('seq 1');
    expect(verify(root, catalogUpcasters()).issues.map((i) => i.seq)).toEqual([1]);
  });

  /**
   * THE TWO GATES OF SECTION 6.2, WHICH HAD NO CASE UNTIL A MUTATION SAID SO.
   *
   * Both cases below exist because turning the gate off in the verifier left ZERO tests
   * red. A gate nothing exercises is a gate nobody has checked, and these two are not
   * ornamental: they are what stops a party with NO KEY denying the authenticity of an
   * honest, fully-signed chain — the only place in this format where an attacker's win
   * condition is making a good record read as bad.
   */
  it('a residual key.revoked does NOT remove a key — a keyless denial, refused by both', () => {
    // A keyless party appends a revocation above the last checkpoint. It is well-formed, it
    // names a member as its signer, and nothing about the line is wrong. If a reader
    // honoured it, B's later work — which IS signature-covered — would stop verifying, and
    // an honest chain would read as broken on the say-so of somebody who holds no key.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const residualRevoke = keyRevoked(
      { at: at(2), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'not by the owner' },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolled(anchor, a, b), residualRevoke], a, {
      residual: 1,
    });
    writeTail(`${b.fingerprint}-i2`, [task(anchor, b, 't-1', 3)], b);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'a keyless revocation must not be able to refuse honest work').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    // NON-VACUITY: the revocation really is in the window, or the gate was never reached.
    expect(verify(root, catalogUpcasters()).uncheckpointedEvents).toBe(1);
  });

  it('a checkpoint whose signature FAILS covers nothing, so its range stays residual', () => {
    // The other half of "covered": coverage is what a VERIFIED checkpoint reaches, not what
    // a checkpoint claims. Here the revocation sits inside a range a checkpoint names and
    // whose signature does not verify — so it is exactly as uncovered as the case above, and
    // B's work must survive it. A reader that counted the claim would refuse B's event too.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const revoke = keyRevoked(
      { at: at(2), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'inside a checkpoint that does not verify' },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolled(anchor, a, b), revoke], a, {
      breakSignature: true,
    });
    writeTail(`${b.fingerprint}-i2`, [task(anchor, b, 't-1', 3)], b);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    // EXACTLY ONE refusal, and it is the signature. B's event is not among them: the broken
    // checkpoint covers nothing, so the revocation inside it took no effect.
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('signature does not verify');
    expect(
      verify(root, catalogUpcasters())
        .issues.map((i) => i.detail)
        .join('\n'),
      'the revocation inside an unverified checkpoint must not remove the key',
    ).not.toContain('not a key enrolled');
  });

  it('a residual re-enrolment does NOT undo a covered revocation — refused by both', () => {
    // THE MIRROR OF THE REVOKE GATE, and the third case a mutation had to ask for: turning
    // this one off left zero tests red too. An ADDITION is usually safe ungated — it only
    // empowers events naming the key it adds, which sit in the same untrusted window — with
    // exactly one exception: an addition ordered AFTER a signature-covered revocation of the
    // SAME key RESTORES it, and thereby undoes a signed removal, re-authorizing that key's
    // later checkpointed work. So it is gated exactly as the revocation was.
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const revoke = keyRevoked(
      { at: at(4), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'rotation' },
    );
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolled(anchor, a, b), revoke, enrolled(anchor, a, b, 5)],
      a,
      // The re-enrolment is the residual one: a keyless party appends it above the
      // checkpoint that covers the revocation.
      { residual: 1 },
    );
    writeTail(`${b.fingerprint}-i2`, [task(anchor, b, 't-1', 6)], b);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    const said = refused.join('\n');
    expect(said, 'the re-add itself has to be named, not silently dropped').toContain('re-adds');
    expect(said, 'and B must still be out, or the revocation was undone').toContain(
      'not a key enrolled',
    );
    expect(
      verify(root, catalogUpcasters())
        .issues.map((i) => i.detail)
        .join('\n'),
    ).toContain('re-adds');
  });
});
