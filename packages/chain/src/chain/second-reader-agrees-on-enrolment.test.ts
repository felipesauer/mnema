/**
 * THE TWO READERS OVER RECORDS THIS PRODUCT WROTE, and the question is not the one
 * the mutation table asks.
 *
 * The mutation table asks *does the second reader refuse what the product refuses*, and
 * it is answered by building attacks. This file asks the other half, which is the one
 * nobody goes looking for: **does it refuse anything the product ACCEPTS?**
 *
 * Refusing too much is the quieter of the two failures, because it looks like rigour. It
 * happened here, and it is why this file exists. With no field declarations published, the
 * only derivation of the envelope a stranger could make was the INTERSECTION of the
 * published vectors' top-level keys, which `FORMAT.md` section 7 stated as a fact, in so
 * many words. `which` was carried by sixteen of the twenty-three vectors published when
 * this was found, and `run` by three, so an intersection is not the envelope; the second reader consequently REFUSED an
 * honest event for carrying `which`, on a record the product read as fine. Nothing caught
 * it: the frozen records happen to hold only events that carry neither, and every mutation
 * in the table is an attack, so every case in the suite was asking the other question.
 * Gap G25.
 *
 * SECTION 6.2 IS THE OTHER HALF, and it is the one with room to be over-strict. Enrolment
 * is a FOLD (an order across tails, a set that grows and shrinks, and two gates that turn
 * on signature coverage), so a reader that got any of that slightly wrong would refuse
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
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agentEnrolled,
  agentEnrollmentMessage,
  agentRetired,
  backupDeclared,
  channelRefused,
  checkerEnrolled,
  checkerEnrollmentMessage,
  checkerRetired,
  checkPassed,
  enrollmentMessage,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  knowledgeLinked,
  linkRetracted,
  memoryCaptured,
  noteRetracted,
  runStarted,
  runUnannounced,
  stackAdopted,
  stackRemoved,
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
 * `residual` leaves that many trailing events OUT of the checkpoint: the window a party
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
 * refused, and that is what is asserted: in BOTH directions, so a reader that refused
 * everything would fail here just as loudly as one that refused nothing.
 */
function bothReaders(): { productOk: boolean; verdict: string; refused: readonly string[] } {
  const here = verify(root, catalogUpcasters());
  const there = secondReading(root);
  return { productOk: here.ok, verdict: there.verdict, refused: refusals(there) };
}

/**
 * What the product refused, by its words. A case that asserts only `productOk` passes as long as
 * ANY refusal holds, so the refusal a case is about is named here, as the second reader's is.
 */
function productRefused(): readonly string[] {
  return verify(root, catalogUpcasters()).issues.map((issue) => issue.detail);
}

describe('the two readers agree on records the product itself wrote: enrolment', () => {
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

  it('an honest event carrying `which` and `run`: green on both, the over-refusal, gone', () => {
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
    // made for a DIFFERENT anchor does not carry across, which is only checkable by a
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

  it('a revocation is prospective: before stays, after is refused, by both', () => {
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
   * honest, fully-signed chain, the only place in this format where an attacker's win
   * condition is making a good record read as bad.
   */
  it('a residual key.revoked does NOT remove a key: a keyless denial, refused by both', () => {
    // A keyless party appends a revocation above the last checkpoint. It is well-formed, it
    // names a member as its signer, and nothing about the line is wrong. If a reader
    // honoured it, B's later work, which IS signature-covered, would stop verifying, and
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
    // whose signature does not verify, so it is exactly as uncovered as the case above, and
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

  it('a residual re-enrolment does NOT undo a covered revocation: refused by both', () => {
    // THE MIRROR OF THE REVOKE GATE, and the third case a mutation had to ask for: turning
    // this one off left zero tests red too. An ADDITION is usually safe ungated (it only
    // empowers events naming the key it adds, which sit in the same untrusted window) with
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

/**
 * THE NEWEST KIND, READ BY BOTH. `channel.refused` reached the second reader the only way a
 * kind can: as a row of `event-schema.json` and a row of the vectors. Nothing in the Python was
 * edited for it, which is the claim worth testing: that a stranger's reader, handed the two
 * published artifacts, accepts the kind exactly where the product does and refuses it exactly
 * where the product does.
 */
describe('the two readers agree on records the product itself wrote: a refusal', () => {
  const RULE = '019f81f8-e400-7006-8000-000000000006';

  function refusal(
    anchor: string,
    signer: KeyPair,
    when: number,
    payload: Record<string, unknown> = { rule: RULE, path: 'src/ledger/posting.ts' },
    v = 1,
  ): CatalogEvent {
    const built = channelRefused(
      {
        at: at(when),
        who: anchor,
        signerFp: signer.fingerprint,
        subject: 'edit-refuses-a-write',
        which: 'claude',
      },
      { rule: RULE, path: 'src/ledger/posting.ts' },
    );
    return { ...built, v, payload } as unknown as CatalogEvent;
  }

  it('a signed refusal and one above the checkpoint: green on both', () => {
    // One inside the checkpoint (byte identity under the signature) and one in the residual
    // window, where the only thing standing between a forger and the record is the per-kind
    // rebuild of section 4.1: the path a kind unknown to the schema would fail on.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), refusal(anchor, kp, 2), refusal(anchor, kp, 3)],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest channel.refused').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a refusal with a forged payload field, above the checkpoint: refused by both', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [
        founding(kp),
        refusal(anchor, kp, 2, { rule: RULE, path: 'src/ledger/posting.ts', grade: 'ask' }),
      ],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('grade');
  });

  it('a refusal that cites no rule, above the checkpoint: refused by both', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), refusal(anchor, kp, 2, { rule: '', path: 'src/ledger/posting.ts' })],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('rule');
  });

  it('a refusal at a version no row declares: refused by both, what an older reader does', () => {
    // A reader meeting a (kind, v) its table does not hold refuses the line rather than guess
    // (section 4.1). It is the same thing a reader from BEFORE this kind does with a
    // `channel.refused` v1, which is why a version ahead is the case that stands for it here.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), refusal(anchor, kp, 2, undefined, 2)], kp, {
      residual: 1,
    });

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('channel.refused');
  });
});

/**
 * A STACK ADOPTED AND REMOVED, READ BY BOTH. The two kinds reached the second reader the way
 * every kind since `channel.refused` has (a row of `event-schema.json` each and a row of the
 * vectors each, and no line of Python), so the claim is the same: the stranger's reader accepts
 * the facts exactly where the product does, and refuses them exactly where the product does.
 */
describe('the two readers agree on records the product itself wrote: a stack adopted', () => {
  const DIGEST = 'b'.repeat(64);
  const HONEST = { name: 'evidence-first', version: '1.0.0', digest: DIGEST, scope: 'public' };

  function adopted(
    anchor: string,
    signer: KeyPair,
    when: number,
    payload: Record<string, unknown> = HONEST,
    v = 1,
  ): CatalogEvent {
    const built = stackAdopted(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: 'evidence-first' },
      { name: 'evidence-first', version: '1.0.0', digest: DIGEST, scope: 'public' },
    );
    return { ...built, v, payload } as unknown as CatalogEvent;
  }

  function removed(anchor: string, signer: KeyPair, when: number): CatalogEvent {
    return stackRemoved(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: 'evidence-first' },
      { version: '1.0.0', digest: DIGEST, scope: 'public' },
    );
  }

  it('an adoption and its removal, signed and above the checkpoint: green on both', () => {
    // The last two sit in the residual window, where the per-kind rebuild of section 4.1 is
    // all that stands between a forger and the record.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), adopted(anchor, kp, 2), adopted(anchor, kp, 3), removed(anchor, kp, 4)],
      kp,
      { residual: 2 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest stack adoption').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('an adoption carrying where it came from, above the checkpoint: refused by both', () => {
    // The field a careless writer would add (the folder the stack was copied from) is no
    // field the contract declares, so a line carrying it is refused rather than read past.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    const withAPath = { ...HONEST, source: '/home/someone/stacks/evidence-first' };
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), adopted(anchor, kp, 2, withAPath)], kp, {
      residual: 1,
    });

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('source');
    expect(productRefused().join('\n')).toContain('source');
  });

  it('an adoption that names no digest, above the checkpoint: refused by both', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    const { digest: _, ...noDigest } = HONEST;
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), adopted(anchor, kp, 2, noDigest)], kp, {
      residual: 1,
    });

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('digest');
  });

  it('an adoption at a version no row declares: refused by both, what an older reader does', () => {
    // A reader from before this kind meets `stack.adopted` v1 exactly as this one meets v2: a
    // (kind, v) its table does not hold, refused rather than guessed at (section 4.1).
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), adopted(anchor, kp, 2, HONEST, 2)], kp, {
      residual: 1,
    });

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('stack.adopted');
  });
});

/**
 * A NOTE TAKEN BACK, READ BY BOTH. `note.retracted` reached the second reader the way
 * `channel.refused` did (a row of `event-schema.json` and a row of the vectors, and no line
 * of Python), so the claim tested is the same: the stranger's reader accepts the retraction
 * exactly where the product does, and refuses it exactly where the product does.
 */
describe('the two readers agree on records the product itself wrote: a retraction', () => {
  const MEMORY = '019f81f8-e400-7001-8000-000000000001';
  const REASON = 'The load turned out to be a key lookup.';

  function memory(anchor: string, signer: KeyPair, when: number): CatalogEvent {
    return memoryCaptured(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: MEMORY },
      { content: 'The cache is SQLite because the load is relational.' },
    );
  }

  function retraction(
    anchor: string,
    signer: KeyPair,
    when: number,
    payload: Record<string, unknown> = { reason: REASON },
    v = 1,
  ): CatalogEvent {
    const built = noteRetracted(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: MEMORY, which: 'claude' },
      { reason: REASON },
    );
    return { ...built, v, payload } as unknown as CatalogEvent;
  }

  it('a signed retraction and one above the checkpoint: green on both', () => {
    // One inside the checkpoint and one in the residual window, where the per-kind rebuild
    // of section 4.1 is all that stands between a forger and the record.
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), memory(anchor, kp, 2), retraction(anchor, kp, 3), retraction(anchor, kp, 4)],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest note.retracted').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a retraction with a forged payload field, above the checkpoint: refused by both', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [
        founding(kp),
        memory(anchor, kp, 2),
        retraction(anchor, kp, 3, { reason: REASON, erase: true }),
      ],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('erase');
  });

  it('a retraction that gives no reason, above the checkpoint: refused by both', () => {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), memory(anchor, kp, 2), retraction(anchor, kp, 3, { reason: '' })],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('reason');
  });

  it('a retraction at a version no row declares: refused by both, what an older reader does', () => {
    // A reader from BEFORE this kind meets a `note.retracted` v1 the way this one meets a v2:
    // a (kind, v) its table does not hold, refused rather than guessed (section 4.1).
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(
      `${kp.fingerprint}-i1`,
      [founding(kp), memory(anchor, kp, 2), retraction(anchor, kp, 3, undefined, 2)],
      kp,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('note.retracted');
  });
});

/**
 * A LINK TAKEN BACK, READ BY BOTH. `link.retracted` reaches the second reader the way
 * `note.retracted` did (a row of `event-schema.json` and a row of the vectors, and no line of
 * Python), so the claims are the same: the stranger's reader accepts the retraction exactly
 * where the product does and refuses it exactly where the product does. And one more, the one
 * authorship adds: a retraction by an identity that never recorded the link is NOT a break on
 * either reader; the product names it in its census and does not apply it (FORMAT.md 6.4),
 * and the format, which decides what verifies and not what is served, accepts it.
 */
describe('the two readers agree on records the product itself wrote: a link retraction', () => {
  const RULE = '019f81f8-e400-7002-8000-000000000002';
  const EDGE = { target: 'src/billing', rel: 'governs' };
  const REASON = 'The rule is about the ledger, not billing.';

  function linked(anchor: string, signer: KeyPair, when: number): CatalogEvent {
    return knowledgeLinked(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: RULE },
      EDGE,
    );
  }

  function retraction(
    anchor: string,
    signer: KeyPair,
    when: number,
    payload: Record<string, unknown> = { ...EDGE, reason: REASON },
    v = 1,
  ): CatalogEvent {
    const built = linkRetracted(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: RULE, which: 'claude' },
      { ...EDGE, reason: REASON },
    );
    return { ...built, v, payload } as unknown as CatalogEvent;
  }

  /** One identity's founded tail holding `events` after its founding. */
  function identityWith(events: (anchor: string, kp: KeyPair) => CatalogEvent[]): string {
    const kp = generateKeyPair();
    commitPublicKey(kp);
    const anchor = deriveAnchor(kp.fingerprint);
    writeTail(`${kp.fingerprint}-i1`, [founding(kp), ...events(anchor, kp)], kp, { residual: 1 });
    return anchor;
  }

  it('the author’s retraction, one inside the checkpoint and one above it: green on both', () => {
    identityWith((anchor, kp) => [
      linked(anchor, kp, 2),
      retraction(anchor, kp, 3),
      retraction(anchor, kp, 4),
    ]);
    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest link.retracted').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a stranger’s retraction: green on both, and named only by the product’s census', () => {
    const author = identityWith((anchor, kp) => [linked(anchor, kp, 2)]);
    const stranger = identityWith((anchor, kp) => [retraction(anchor, kp, 3)]);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const census = verify(root, catalogUpcasters()).census;
    expect(census.filter((note) => note.kind === 'foreign-link-retraction')).toMatchObject([
      { link: { subject: RULE, ...EDGE }, by: stranger, authors: [author] },
    ]);
  });

  it('a retraction with a forged payload field, above the checkpoint: refused by both', () => {
    identityWith((anchor, kp) => [
      linked(anchor, kp, 2),
      retraction(anchor, kp, 3, { ...EDGE, reason: REASON, erase: true }),
    ]);
    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('erase');
  });

  it('a retraction that names no relation, above the checkpoint: refused by both', () => {
    identityWith((anchor, kp) => [
      linked(anchor, kp, 2),
      retraction(anchor, kp, 3, { target: EDGE.target, rel: '', reason: REASON }),
    ]);
    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('rel');
  });

  it('a retraction at a version no row declares: refused by both, what an older reader does', () => {
    identityWith((anchor, kp) => [linked(anchor, kp, 2), retraction(anchor, kp, 3, undefined, 2)]);
    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('link.retracted');
  });
});

/**
 * A KEY THAT SIGNS CHECK RESULTS AND NOTHING ELSE, read by both. The role is a fold rule of
 * section 6.2 (`checker.enrolled` adds a key to the checkers, a `check.passed`/`check.failed`
 * is authentic only under such a key and the anchor it derives, and any other kind under such
 * a key is refused), so the stranger's reader has a line of Python for it, and these cases
 * are where the two have to reach the same polarity.
 */
describe('the two readers agree on records the product itself wrote: a checker', () => {
  const RULE = '019f81f8-e400-7006-8000-000000000006';
  const COMMIT = 'a'.repeat(40);

  function consent(anchor: string, checker: KeyPair): string {
    return Buffer.from(
      sign(checkerEnrollmentMessage(anchor, checker.fingerprint), checker.privateKey),
    ).toString('hex');
  }

  function enrolChecker(
    anchor: string,
    voucher: KeyPair,
    checker: KeyPair,
    sig = consent(anchor, checker),
  ): CatalogEvent {
    return checkerEnrolled(
      {
        at: at(2),
        who: anchor,
        signerFp: voucher.fingerprint,
        subject: deriveAnchor(checker.fingerprint),
      },
      { checkerFp: checker.fingerprint, reverseSig: sig },
    );
  }

  function passed(signer: KeyPair, who = deriveAnchor(signer.fingerprint), when = 4): CatalogEvent {
    return checkPassed(
      { at: at(when), who, signerFp: signer.fingerprint, subject: RULE },
      { commit: COMMIT, command: 'node', args: ['check.js'], output: 'ok' },
    );
  }

  /** A person (A) and a CI key (C); the CI key's .pub committed, as the enrolment commits it. */
  function personAndChecker(): { a: KeyPair; c: KeyPair; anchor: string } {
    const a = generateKeyPair();
    const c = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(c);
    return { a, c, anchor: deriveAnchor(a.fingerprint) };
  }

  it('a checker enrolled by a person, signing a result in its own tail: green on both', () => {
    const { a, c, anchor } = personAndChecker();
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolChecker(anchor, a, c)], a);
    writeTail(`${c.fingerprint}-i2`, [passed(c)], c);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest check result').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a check result signed by a PERSON’s key: refused by both', () => {
    const { a, anchor } = personAndChecker();
    writeTail(`${a.fingerprint}-i1`, [founding(a), passed(a, anchor)], a);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('not enrolled as a checker');
  });

  it('any other kind signed by a checker key: refused by both', () => {
    // The other half of the role: a leaked runner secret must not be able to say anything
    // but a result, not a task, and not its own founding.
    const { a, c, anchor } = personAndChecker();
    const cAnchor = deriveAnchor(c.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolChecker(anchor, a, c)], a);
    writeTail(
      `${c.fingerprint}-i2`,
      [
        identityFounded(
          { at: at(3), who: cAnchor, signerFp: c.fingerprint, subject: cAnchor },
          { foundingFp: c.fingerprint },
        ),
        task(cAnchor, c, 't-1', 4),
      ],
      c,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(2);
    expect(refused.join('\n')).toContain('signs check results only');
  });

  it('a checker enrolment whose consent was given to another identity: refused by both', () => {
    const { a, c, anchor } = personAndChecker();
    const elsewhere = consent(deriveAnchor('deadbeef'), c);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolChecker(anchor, a, c, elsewhere)], a);
    writeTail(`${c.fingerprint}-i2`, [passed(c)], c);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('does not prove the checker consented');
  });

  it('a consent to JOIN an identity, used as a checker enrolment: refused by both', () => {
    // The two messages differ on purpose: `enroll:` is not `check-enroll:`.
    const { a, c, anchor } = personAndChecker();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolChecker(anchor, a, c, reverseSig(anchor, c))],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('does not prove the checker consented');
  });

  // RETIRING THE ROLE. `checker.retired` takes a key out of the checkers when it is itself
  // signature-covered; what the key signed before stays authentic, what it signs after does
  // not, and it never signs anything else or comes back.

  function retire(anchor: string, signer: KeyPair, checker: KeyPair, when: number): CatalogEvent {
    return checkerRetired(
      {
        at: at(when),
        who: anchor,
        signerFp: signer.fingerprint,
        subject: deriveAnchor(checker.fingerprint),
      },
      { checkerFp: checker.fingerprint, reason: 'the runner secret leaked' },
    );
  }

  it('a result signed before the retirement: green on both', () => {
    const { a, c, anchor } = personAndChecker();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolChecker(anchor, a, c), retire(anchor, a, c, 5)],
      a,
    );
    writeTail(`${c.fingerprint}-i2`, [passed(c, undefined, 3)], c);

    const { productOk, verdict, refused } = bothReaders();
    expect(
      refused,
      'the second reader refuses a result signed while the key held the role',
    ).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    // Authentic, and named: "before" is placed by the `at` the key itself wrote, so the
    // product's census says which key it was and how many results it signed before.
    const census = verify(root, catalogUpcasters()).census;
    expect(census).toEqual([
      expect.objectContaining({
        kind: 'retired-checker',
        fingerprint: c.fingerprint,
        by: anchor,
        resultsBefore: 1,
      }),
    ]);
  });

  it('a result signed after the retirement: refused by both', () => {
    // The defect this kind exists for: a leaked key went on signing passes the verifier took.
    const { a, c, anchor } = personAndChecker();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolChecker(anchor, a, c), retire(anchor, a, c, 3)],
      a,
    );
    writeTail(`${c.fingerprint}-i2`, [passed(c, undefined, 4)], c);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('retired');
  });

  it('a retirement in the window no checkpoint covers: ignored by both', () => {
    // A keyless party could append it there; honouring it would turn the honest results the
    // key signs afterwards into failures with no key at all: the revocation's gate, mirrored.
    const { a, c, anchor } = personAndChecker();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolChecker(anchor, a, c), retire(anchor, a, c, 3)],
      a,
      { residual: 1 },
    );
    writeTail(`${c.fingerprint}-i2`, [passed(c, undefined, 4)], c);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader honours an uncovered retirement').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a retirement signed by a key not valid for its who: refused by both', () => {
    const { a, c, anchor } = personAndChecker();
    const stranger = generateKeyPair();
    commitPublicKey(stranger);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolChecker(anchor, a, c)], a);
    // In the stranger's OWN tail, under a checkpoint the stranger signed: the one place a key can
    // put a fact, so the only refusal left to it is the one this case is about.
    writeTail(`${stranger.fingerprint}-i3`, [retire(anchor, stranger, c, 3)], stranger);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'checker.retired is signed by a key not valid for its who at this point',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('checker.retired is signed by a key not valid');
  });

  it('a retired key enrolled again, or signing any other kind: refused by both', () => {
    // A retired key does not come back, and it does not become a person: its own founding
    // would put the anchor its results were signed under into an identity.
    const { a, c, anchor } = personAndChecker();
    const cAnchor = deriveAnchor(c.fingerprint);
    writeTail(
      `${a.fingerprint}-i1`,
      [
        founding(a),
        enrolChecker(anchor, a, c),
        retire(anchor, a, c, 3),
        checkerEnrolled(
          { at: at(5), who: anchor, signerFp: a.fingerprint, subject: cAnchor },
          { checkerFp: c.fingerprint, reverseSig: consent(anchor, c) },
        ),
      ],
      a,
    );
    writeTail(
      `${c.fingerprint}-i2`,
      [
        identityFounded(
          { at: at(4), who: cAnchor, signerFp: c.fingerprint, subject: cAnchor },
          { foundingFp: c.fingerprint },
        ),
      ],
      c,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    const said = productRefused();
    expect(said).toHaveLength(2);
    expect(said.join('\n')).toContain(
      `identity.founded is signed by ${c.fingerprint}, a checker key retired at this point, which signs nothing`,
    );
    expect(said.join('\n')).toContain('which is never enrolled again');
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(2);
    expect(refused.join('\n')).toContain('a retired checker key, which signs nothing');
    expect(refused.join('\n')).toContain('which is never enrolled again');
  });
});

/**
 * A KEY THAT SIGNS FOR ITS PERSON, UNDER A NAME, read by both (FORMAT.md section 6.2). An agent
 * key is a member of the identity that enrolled it, and the role narrows what it signs: never
 * for another identity, never under another `which`, never a fact that changes who may sign. The
 * fold reads it, so the stranger's reader has lines of Python for it, and every case here is one
 * where the two have to reach the same polarity, and, where it is honest, the same census.
 */
describe('the two readers agree on records the product itself wrote: an agent', () => {
  function consent(anchor: string, agent: KeyPair, name: string): string {
    return Buffer.from(
      sign(agentEnrollmentMessage(anchor, agent.fingerprint, name), agent.privateKey),
    ).toString('hex');
  }

  function enrolAgent(
    anchor: string,
    voucher: KeyPair,
    agent: KeyPair,
    opts: { name?: string; sig?: string; when?: number } = {},
  ): CatalogEvent {
    const name = opts.name ?? 'claude';
    return agentEnrolled(
      { at: at(opts.when ?? 2), who: anchor, signerFp: voucher.fingerprint, subject: anchor },
      { agentFp: agent.fingerprint, name, reverseSig: opts.sig ?? consent(anchor, agent, name) },
    );
  }

  function retireAgent(anchor: string, signer: KeyPair, agent: KeyPair, when: number) {
    return agentRetired(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: anchor },
      { agentFp: agent.fingerprint, reason: 'the machine was lent out' },
    );
  }

  /** A fact the agent key signs, for `who`, naming `which` (none when it is null). */
  function byAgent(
    who: string,
    agent: KeyPair,
    id: string,
    when: number,
    which: string | null = 'claude',
  ): CatalogEvent {
    return task(who, agent, id, when, which === null ? {} : { which });
  }

  /** A person (A) and an agent key (G); G's .pub committed, as the enrolment commits it. */
  function personAndAgent(): { a: KeyPair; g: KeyPair; anchor: string } {
    const a = generateKeyPair();
    const g = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(g);
    return { a, g, anchor: deriveAnchor(a.fingerprint) };
  }

  /**
   * What each reader counts of the agents the record's facts name (`attested <name> <n>` for an
   * agent key's facts, `declared <which> <n>` for a `which` a key without the role wrote) sorted,
   * so the two lists are compared and not two wordings.
   */
  function agentCensus(): { product: readonly string[]; second: readonly string[] } {
    const product = verify(root, catalogUpcasters())
      .census.flatMap((note) =>
        note.kind === 'attested-which'
          ? [`attested ${note.name} ${note.events}`]
          : note.kind === 'declared-which'
            ? [`declared ${note.which} ${note.events}`]
            : note.kind === 'unannounced-which'
              ? [`unannounced ${note.which} ${note.events}`]
              : [],
      )
      .sort();
    const second = secondNotes()
      .flatMap((said) => {
        const attested = /^6\.2: (\d+) event\(s\) attested by an agent key enrolled as "(.*)"/.exec(
          said,
        );
        if (attested !== null) return [`attested ${attested[2]} ${attested[1]}`];
        const declared = /^6\.2: (\d+) event\(s\) name the agent "(.*)": declared/.exec(said);
        if (declared !== null) return [`declared ${declared[2]} ${declared[1]}`];
        const unannounced = /^6\.9: (\d+) event\(s\) name the agent "(.*)": no name/.exec(said);
        return unannounced === null ? [] : [`unannounced ${unannounced[2]} ${unannounced[1]}`];
      })
      .sort();
    return { product, second };
  }

  it('an agent key signing for its person, as its name: green on both, and both count it', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), task(anchor, a, 't-0', 3, { which: 'claude' })],
      a,
    );
    writeTail(
      `${g.fingerprint}-i2`,
      [byAgent(anchor, g, 't-1', 4), byAgent(anchor, g, 't-2', 5)],
      g,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest agent').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    // The same count in both, and the person's own `which` said as what it is: declared.
    const { product, second } = agentCensus();
    expect(product).toEqual(['attested claude 2', 'declared claude 1']);
    expect(second).toEqual(product);
  });

  it('a run marked run.unannounced: green on both, and both count its facts apart from the declared ones', () => {
    const { a, anchor } = personAndAgent();
    const b = generateKeyPair();
    commitPublicKey(b);
    const run = (id: string, when: number, signer: KeyPair = a): CatalogEvent =>
      runStarted(
        { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: id, which: 'unknown-agent' },
        { agent: 'unknown-agent' },
      );
    const mark = (id: string, when: number, signer: KeyPair = a): CatalogEvent =>
      runUnannounced(
        {
          at: at(when),
          who: anchor,
          signerFp: signer.fingerprint,
          subject: id,
          run: id,
          which: 'unknown-agent',
        },
        { handshake: false },
      );
    writeTail(
      `${a.fingerprint}-i1`,
      [
        founding(a),
        enrolled(anchor, a, b),
        // A run whose client announced no name: its birth, its mark and its one fact.
        run('r-1', 3),
        mark('r-1', 3),
        task(anchor, a, 't-1', 4, { which: 'unknown-agent', run: 'r-1' }),
        // A run whose client announced the literal name: nothing marks it.
        run('r-2', 5),
        task(anchor, a, 't-2', 6, { which: 'unknown-agent', run: 'r-2' }),
      ],
      a,
    );
    // Another key of the same identity, under the run id the first key marked: the mark is the
    // first key's, and says nothing of this one.
    writeTail(
      `${b.fingerprint}-i2`,
      [task(anchor, b, 't-3', 7, { which: 'unknown-agent', run: 'r-1' })],
      b,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an honest mark').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const { product, second } = agentCensus();
    expect(product).toEqual(['declared unknown-agent 3', 'unannounced unknown-agent 3']);
    expect(second).toEqual(product);
  });

  it('two keys enrolled under one name, one per machine: green on both, each counted by its own key', () => {
    const { a, g, anchor } = personAndAgent();
    // The same name on a second machine: the format keys an agent by its fingerprint, never by its
    // name, so two live keys named "claude" are two agents of one name.
    const h = generateKeyPair();
    commitPublicKey(h);
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g, { when: 2 }), enrolAgent(anchor, a, h, { when: 3 })],
      a,
    );
    writeTail(
      `${g.fingerprint}-i2`,
      [byAgent(anchor, g, 't-1', 4), byAgent(anchor, g, 't-2', 5)],
      g,
    );
    writeTail(`${h.fingerprint}-i3`, [byAgent(anchor, h, 't-3', 6)], h);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses two keys under one name').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const { product, second } = agentCensus();
    expect(product).toEqual(['attested claude 1', 'attested claude 2']);
    expect(second).toEqual(product);
    expect(
      verify(root, catalogUpcasters())
        .census.flatMap((note) =>
          note.kind === 'attested-which' ? [`${note.agentFp} ${note.events}`] : [],
        )
        .sort(),
    ).toEqual([`${g.fingerprint} 2`, `${h.fingerprint} 1`].sort());
  });

  it('an agent key under another `which`: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g)], a);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 3, 'codex')], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      `task.created is signed by ${g.fingerprint}, an agent key enrolled as "claude", and its which does not name that agent`,
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('its which is not the name the key was enrolled under');
  });

  it('an agent key with no `which`: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g)], a);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 3, null)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      `task.created is signed by ${g.fingerprint}, an agent key enrolled as "claude", and its which does not name that agent`,
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('its which is not the name the key was enrolled under');
  });

  it('an agent key speaking for another identity that took it in: refused by both', () => {
    // B makes the agent key a plain member of its own identity and the key then writes as B.
    // The enrolment is refused where it is written (a key holds one role), and the fact the key
    // signs as B is refused as well: it speaks for an identity other than the one that enrolled it.
    const { a, g, anchor } = personAndAgent();
    const b = generateKeyPair();
    commitPublicKey(b);
    const bAnchor = deriveAnchor(b.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g)], a);
    writeTail(`${b.fingerprint}-i3`, [founding(b), enrolled(bAnchor, b, g, 3)], b);
    writeTail(`${g.fingerprint}-i2`, [byAgent(bAnchor, g, 't-1', 4)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect([...productRefused()].sort()).toEqual([
      'key.enrolled names a key that holds the agent role at this point: a key holds one role only',
      `task.created is signed by ${g.fingerprint}, an agent key, for an identity other than the one that enrolled it`,
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(2);
    expect(refused.join('\n')).toContain(
      'key.enrolled names a key that holds the agent role at this point: a key holds one role only',
    );
    expect(refused.join('\n')).toContain('for an identity other than the one that enrolled it');
  });

  it('a key.enrolled naming the agent key of its own identity: refused by both, at the enrolment', () => {
    // The identity that gave the key the role enrols it again as a plain member. Nothing the key
    // signs is needed for the refusal: the enrolment itself names a key that holds a role.
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), enrolled(anchor, a, g, 3)],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productRefused()).toEqual([
      'key.enrolled names a key that holds the agent role at this point: a key holds one role only',
    ]);
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(
      /^6\.2: key\.enrolled names a key that holds the agent role at this point: a key holds one role only \(.*seq 2.*\)$/,
    );
  });

  it('a key.enrolled naming an agent key the record retired: refused by both, at the enrolment', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [
        founding(a),
        enrolAgent(anchor, a, g),
        retireAgent(anchor, a, g, 3),
        enrolled(anchor, a, g, 4),
      ],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productRefused()).toEqual([
      'key.enrolled names a key that holds the agent role at this point: a key holds one role only',
    ]);
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('a key holds one role only');
  });

  it('a key.enrolled BEFORE the agent enrolment of the same key: the agent enrolment is the one refused', () => {
    // The order the other way was refused already (section 6.2, `agent.enrolled`): the key is in
    // an identity at that point. The new row changes nothing here.
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolled(anchor, a, g, 2), enrolAgent(anchor, a, g, { when: 3 })],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productRefused()).toEqual([
      'agent.enrolled names a key that is already in an identity, or holds a role, at this point',
    ]);
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
  });

  it('a record that has not heard of the agent enrolment takes the key as an ordinary member: green on both', () => {
    // Only B's record: B founds, and B's own key vouches for the key g; an `agent.enrolled` in
    // another record never reaches this one. The key is a plain member here and writes as B.
    const g = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(b);
    commitPublicKey(g);
    const bAnchor = deriveAnchor(b.fingerprint);
    writeTail(`${b.fingerprint}-i1`, [founding(b), enrolled(bAnchor, b, g, 2)], b);
    writeTail(`${g.fingerprint}-i2`, [task(bAnchor, g, 't-1', 3, {})], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses an ordinary member').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('an agent key signing a change to who may sign (its own retirement too): refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    const h = generateKeyPair();
    commitPublicKey(h);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g)], a);
    writeTail(
      `${g.fingerprint}-i2`,
      [
        keyEnrolled(
          { at: at(3), who: anchor, signerFp: g.fingerprint, subject: anchor, which: 'claude' },
          { newFp: h.fingerprint, reverseSig: reverseSig(anchor, h) },
        ),
        agentRetired(
          { at: at(4), who: anchor, signerFp: g.fingerprint, subject: anchor, which: 'claude' },
          { agentFp: g.fingerprint, reason: 'out of sight' },
        ),
      ],
      g,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      `key.enrolled is signed by ${g.fingerprint}, an agent key, which signs no change to who may sign or what a key may sign`,
      `agent.retired is signed by ${g.fingerprint}, an agent key, which signs no change to who may sign or what a key may sign`,
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(2);
    expect(refused.join('\n')).toContain('which signs no change to who may sign');
  });

  it('an agent enrolment whose consent was given under another name: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g, { sig: consent(anchor, g, 'codex') })],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'agent.enrolled reverse signature does not prove the agent consented to this name',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('does not prove the agent consented');
  });

  it.each([
    ['ends in U+00A0, which the set holds: refused by both', 'claude\u00a0', false],
    [
      'ends in U+001F, which Python’s strip() takes and the set does not: verified by both',
      'claude\u001f',
      true,
    ],
  ])('a name that %s', (_said, name, honest) => {
    const { a, g, anchor } = personAndAgent();
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g, { name })], a);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 3, name)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(honest);
    expect(verdict).toBe(honest ? 'VERIFIED' : 'REFUSED');
    if (honest) {
      expect(refused).toEqual([]);
      return;
    }
    // The enrolment is refused, so the key holds no role and no membership: its fact fails too.
    expect(productRefused()).toContain(
      'agent.enrolled name begins or ends with a character of the set section 6.2 writes out',
    );
    expect(refused.join('\n')).toContain('name begins or ends with');
  });

  it('a retirement no checkpoint covers: ignored by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), retireAgent(anchor, a, g, 3)],
      a,
      { residual: 1 },
    );
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 4)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader honours an uncovered retirement').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('a covered retirement: what the key signed before stands, what it signs after is refused, by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), retireAgent(anchor, a, g, 4)],
      a,
    );
    writeTail(
      `${g.fingerprint}-i2`,
      [byAgent(anchor, g, 't-1', 3), byAgent(anchor, g, 't-2', 5)],
      g,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      `task.created is signed by ${g.fingerprint}, an agent key retired at this point, which signs nothing`,
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('a retired agent key, which signs nothing');
  });

  it('the same key enrolled as an agent twice: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), enrolAgent(anchor, a, g, { when: 3 })],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'agent.enrolled names a key that is already in an identity, or holds a role, at this point',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('already in an identity, or holds a role');
  });

  it('an agent named by its own anchor: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g, { name: anchor })], a);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual(['agent.enrolled name is its who']);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('name is its who');
  });

  it("another identity retiring this one's agent key: refused by both, and the key keeps signing", () => {
    // B is a real identity with its own key, and it names A's agent key. The refusal has to be
    // that the key is not B's agent; a reader that let it through would take the key out of A's
    // reach, and G's later fact would be refused as a retired key's, a second line here.
    const { a, g, anchor } = personAndAgent();
    const b = generateKeyPair();
    commitPublicKey(b);
    const bAnchor = deriveAnchor(b.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g)], a);
    writeTail(`${b.fingerprint}-i3`, [founding(b), retireAgent(bAnchor, b, g, 3)], b);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 4)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'agent.retired names a key that is not an agent key of its identity',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('not an agent key of its identity');
  });

  /** B: a real identity with its own key, founded in its own tail, that is not A. */
  function stranger(): { b: KeyPair; bAnchor: string } {
    const b = generateKeyPair();
    commitPublicKey(b);
    return { b, bAnchor: deriveAnchor(b.fingerprint) };
  }

  it('an agent enrolment into an identity, signed by a key outside its set: refused by both', () => {
    // B vouches for G in A's name and G consents: every other check passes. Only that B's key is
    // not A's makes it a forgery, and a reader without the check would take G in as A's agent.
    const { a, g, anchor } = personAndAgent();
    const { b } = stranger();
    writeTail(`${a.fingerprint}-i1`, [founding(a)], a);
    writeTail(`${b.fingerprint}-i3`, [founding(b), enrolAgent(anchor, b, g)], b);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 4)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    // G's own fact, for an identity G was never validly enrolled into, is the second line. The
    // order follows the tails' names, which are random keys, so the two lines are compared sorted.
    expect([...productRefused()].sort()).toEqual(
      [
        'agent.enrolled is signed by a key not valid for the anchor at this point',
        `event signer ${g.fingerprint} is not a key enrolled for ${anchor} at this point`,
      ].sort(),
    );
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(2);
    expect(refused.join('\n')).toContain(
      'agent.enrolled is signed by a key not valid for the anchor',
    );
    expect(refused.join('\n')).toContain('is not a key enrolled for');
  });

  it('an agent retirement signed by a key outside the identity: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    const { b } = stranger();
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g)], a);
    writeTail(`${b.fingerprint}-i3`, [founding(b), retireAgent(anchor, b, g, 3)], b);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 4)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'agent.retired is signed by a key not valid for the anchor at this point',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('signed by a key not valid for the anchor');
  });

  it('an agent enrolment whose who is not its subject: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    const { bAnchor } = stranger();
    const forged = agentEnrolled(
      { at: at(2), who: bAnchor, signerFp: a.fingerprint, subject: anchor },
      { agentFp: g.fingerprint, name: 'claude', reverseSig: consent(anchor, g, 'claude') },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), forged], a);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual(['agent.enrolled who is not the anchor it enrols into']);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('who is not the anchor it enrols into');
  });

  it('an agent retirement whose who is not its subject: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    const { bAnchor } = stranger();
    const forged = agentRetired(
      { at: at(3), who: bAnchor, signerFp: a.fingerprint, subject: anchor },
      { agentFp: g.fingerprint, reason: 'the machine was lent out' },
    );
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g), forged], a);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual(['agent.retired who is not the anchor it retires from']);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('who is not the anchor it retires from');
  });

  it('a retired agent key enrolled again: refused by both', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [
        founding(a),
        enrolAgent(anchor, a, g),
        retireAgent(anchor, a, g, 3),
        enrolAgent(anchor, a, g, { when: 4 }),
      ],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'agent.enrolled names a key that is already in an identity, or holds a role, at this point',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('already in an identity, or holds a role');
  });

  it('an agent key taken out by a key revocation, not retired, enrolled again under another name: refused by both', () => {
    // `key.revoked` removes the key from the identity and leaves the role with it, so the key is
    // in no identity at this point; only the role map still says it was an agent. Without that
    // memory the key would come back under a new name, and its past facts would be read as
    // another agent's.
    const { a, g, anchor } = personAndAgent();
    const revoke = keyRevoked(
      { at: at(3), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: g.fingerprint, reason: 'the machine was lent out' },
    );
    writeTail(
      `${a.fingerprint}-i1`,
      [
        founding(a),
        enrolAgent(anchor, a, g),
        revoke,
        enrolAgent(anchor, a, g, { name: 'gemini', when: 4 }),
      ],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'agent.enrolled names a key that is already in an identity, or holds a role, at this point',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('already in an identity, or holds a role');
  });

  it('a name with a colon and a letter outside ASCII, consented to over its UTF-8: green on both', () => {
    // The consent is `agent-enroll:<anchor>:<agentFp>:<name>` in UTF-8, the name last and whole.
    // A reader that encoded it any other way (latin-1 writes U+00E9 as one byte, not two) would
    // not verify the agent's signature, and would refuse an honest enrolment.
    const name = 'clau:dé';
    const { a, g, anchor } = personAndAgent();
    const message = agentEnrollmentMessage(anchor, g.fingerprint, name);
    expect(Buffer.from(message).subarray(-8).toString('hex')).toBe('636c61753a64c3a9');
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolAgent(anchor, a, g, { name })], a);
    writeTail(`${g.fingerprint}-i2`, [byAgent(anchor, g, 't-1', 3, name)], g);

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses a name it encoded differently').toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const { product, second } = agentCensus();
    expect(product).toEqual([`attested ${name} 1`]);
    expect(second).toEqual(product);
  });

  /**
   * What each reader says of an agent key the record retired: `<fp12> by <by17> <n>`, one per key
   * that signed accepted facts before its retirement (the count the checker's note carries as
   * `resultsBefore`), sorted, so the two lists are compared and not two wordings.
   */
  function retiredAgentCensus(): { product: readonly string[]; second: readonly string[] } {
    const product = verify(root, catalogUpcasters())
      .census.flatMap((note) =>
        note.kind === 'retired-agent'
          ? [`${note.fingerprint.slice(0, 12)} by ${note.by.slice(0, 17)} ${note.eventsBefore}`]
          : [],
      )
      .sort();
    const second = secondNotes()
      .flatMap((said) => {
        const retired =
          /^6\.2: (\d+) event\(s\) signed by the agent key (\S+) before (\S+) retired it/.exec(
            said,
          );
        return retired === null ? [] : [`${retired[2]} by ${retired[3]} ${retired[1]}`];
      })
      .sort();
    return { product, second };
  }

  it('a retired agent key that signed before: both name it, with the same count', () => {
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), retireAgent(anchor, a, g, 5)],
      a,
    );
    writeTail(
      `${g.fingerprint}-i2`,
      [byAgent(anchor, g, 't-1', 3), byAgent(anchor, g, 't-2', 4)],
      g,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused, 'the second reader refuses what the key signed while it held the role').toEqual(
      [],
    );
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const { product, second } = retiredAgentCensus();
    expect(product).toEqual([`${g.fingerprint.slice(0, 12)} by ${anchor.slice(0, 17)} 2`]);
    expect(second).toEqual(product);
    expect(
      verify(root, catalogUpcasters()).census.filter((note) => note.kind === 'retired-agent'),
    ).toMatchObject([{ fingerprint: g.fingerprint, by: anchor, eventsBefore: 2 }]);
  });

  it('a retired agent key that signed nothing, or whose retirement no checkpoint covers: named by neither', () => {
    // The checker's note is for a key that signed BEFORE; a key retired with nothing to its name
    // leaves nothing to say, and an ignored retirement retired nothing.
    const { a, g, anchor } = personAndAgent();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolAgent(anchor, a, g), retireAgent(anchor, a, g, 3)],
      a,
    );
    expect(bothReaders().productOk).toBe(true);
    expect(retiredAgentCensus()).toEqual({ product: [], second: [] });

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const again = personAndAgent();
    writeTail(
      `${again.a.fingerprint}-i1`,
      [
        founding(again.a),
        enrolAgent(again.anchor, again.a, again.g),
        retireAgent(again.anchor, again.a, again.g, 5),
      ],
      again.a,
      { residual: 1 },
    );
    writeTail(`${again.g.fingerprint}-i2`, [byAgent(again.anchor, again.g, 't-1', 3)], again.g);
    expect(bothReaders().productOk).toBe(true);
    expect(retiredAgentCensus()).toEqual({ product: [], second: [] });
  });
});

/**
 * A KEY KEPT AS A BACKUP, said by the record (FORMAT.md section 6.5).
 *
 * A cold backup signs nothing until it is restored, so it never has a tail, and a reader that
 * crosses `keys/` against `tails/` used to say it the only way the bytes allowed: a committed key
 * whose tail may have gone. On every clone, for every honest record: a warning that is always on
 * teaches a reader to skip the one that is not. `backup.declared` puts the role in the record, so
 * every reader can tell the key built to write nothing from a key whose writing went missing, and
 * the warning keeps its meaning for the second.
 */
describe('the two readers agree on records the product itself wrote: a declared backup', () => {
  function declared(anchor: string, signer: KeyPair, backup: KeyPair, when = 3): CatalogEvent {
    return backupDeclared(
      { at: at(when), who: anchor, signerFp: signer.fingerprint, subject: anchor },
      { backupFp: backup.fingerprint },
    );
  }

  /** The keys each reader says have no tail and are not an expected backup. */
  function keysWithoutTail(): { product: string[]; second: string[] } {
    const product = verify(root, catalogUpcasters())
      .census.filter((note) => note.kind === 'key-without-tail')
      .map((note) => ('fingerprint' in note ? note.fingerprint : ''));
    const second = secondReading(root)
      .findings.filter((f) => f.level === 'note' && f.what.includes('has no tail on disk'))
      .map((f) => f.what);
    return { product, second };
  }

  /** A founder, and the cold backup it enrolled: the tree `mnema init` leaves. */
  function founderAndBackup(): { a: KeyPair; b: KeyPair; anchor: string } {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    return { a, b, anchor: deriveAnchor(a.fingerprint) };
  }

  it('an honest clone: a declared backup with no tail is expected by both, and neither warns', () => {
    const { a, b, anchor } = founderAndBackup();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolled(anchor, a, b), declared(anchor, a, b)],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    expect(keysWithoutTail()).toEqual({ product: [], second: [] });
    // NON-VACUITY: both readers SAW the key and said it as a backup, rather than not looking.
    const census = verify(root, catalogUpcasters()).census;
    expect(census.map((note) => note.kind)).toEqual(['backup-key']);
    expect(census[0]?.detail).toContain('the record declares it');
    const said = secondReading(root)
      .findings.filter((f) => f.level === 'note')
      .map((f) => f.what)
      .join('\n');
    expect(said).toContain(`${b.fingerprint} has no tail, and the record declares it the backup`);
  });

  it('a tail removed beside a declared backup: both still warn, about that key alone', () => {
    // The declaration answers for ONE key. A second machine of the same identity, enrolled and
    // never declared, whose tail is gone while its key stays, is the reading the warning is for.
    const { a, b, anchor } = founderAndBackup();
    const c = generateKeyPair();
    commitPublicKey(c);
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolled(anchor, a, b), declared(anchor, a, b), enrolled(anchor, a, c, 4)],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const found = keysWithoutTail();
    expect(found.product).toEqual([c.fingerprint]);
    expect(found.second).toHaveLength(1);
    expect(found.second[0]).toContain(c.fingerprint);
    expect(found.second[0]).toContain('declares no backup');
  });

  it('a backup declared and then revoked: both say so, and neither calls it an expected backup', () => {
    // The declaration is real and covered, so "the record declares no backup for it" would be
    // false. But the identity no longer holds the key, so the absence is not expected either:
    // a revoked key with no tail is a real signal, said in words that do not deny the record.
    const { a, b, anchor } = founderAndBackup();
    const revoke = keyRevoked(
      { at: at(4), who: anchor, signerFp: a.fingerprint, subject: anchor },
      { revokedFp: b.fingerprint, reason: 'rotation' },
    );
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolled(anchor, a, b), declared(anchor, a, b), revoke],
      a,
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const found = keysWithoutTail();
    expect(found.product).toEqual([b.fingerprint]);
    const census = verify(root, catalogUpcasters()).census;
    expect(census.map((note) => note.kind)).toEqual(['key-without-tail']);
    expect(census[0]?.detail).toBe(
      `committed public key has no tail on disk: the record declared it a backup of ${anchor}, ` +
        'and that identity has since revoked it, so the absence is no longer expected: the tail ' +
        'may have been dropped (a botched merge), never written (an empty tail is not versioned), ' +
        'or removed',
    );
    expect(found.second).toEqual([
      `the committed key ${b.fingerprint} has no tail on disk, and the record declared it a ` +
        `backup of ${anchor}, which that identity has since revoked, so the absence is no longer ` +
        'expected: the tail may have been dropped, never written, or removed',
    ]);
  });

  it('a declaration of another identity’s key: refused by both, and the key is not silenced', () => {
    // X signs, in its own tail and under its own checkpoint, that A's backup is X's. The key is
    // not a member of X, so the declaration is not X's to make.
    const { a, b, anchor } = founderAndBackup();
    const x = generateKeyPair();
    commitPublicKey(x);
    const xAnchor = deriveAnchor(x.fingerprint);
    writeTail(`${a.fingerprint}-i1`, [founding(a), enrolled(anchor, a, b)], a);
    writeTail(`${x.fingerprint}-i2`, [founding(x), declared(xAnchor, x, b, 4)], x);

    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused()).toEqual([
      'backup.declared names a key that is not a member of its identity at this point',
    ]);
    expect(verdict).toBe('REFUSED');
    expect(refused).toHaveLength(1);
    expect(refused.join('\n')).toContain('backup.declared names a key that is not a member');
    expect(keysWithoutTail().product).toEqual([b.fingerprint]);
  });

  it('a declaration no checkpoint covers: ignored by both, and the key still warns', () => {
    // A party with no key can append in the window above the last checkpoint. Honouring a
    // declaration there would let it silence the warning about a tail it removed.
    const { a, b, anchor } = founderAndBackup();
    writeTail(
      `${a.fingerprint}-i1`,
      [founding(a), enrolled(anchor, a, b), declared(anchor, a, b)],
      a,
      { residual: 1 },
    );

    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
    const found = keysWithoutTail();
    expect(found.product).toEqual([b.fingerprint]);
    expect(found.second).toHaveLength(1);
    expect(found.second[0]).toContain(b.fingerprint);
  });
});

/**
 * The entry hashes of `events` laid on `tailId` from seq 0: what `writeTail` computes, asked
 * for here so a case can cite an entry of another tail.
 */
function entryHashesOf(tailId: string, events: readonly CatalogEvent[]): string[] {
  const hashes: string[] = [];
  let prev: string | null = null;
  for (let seq = 0; seq < events.length; seq += 1) {
    prev = entryHash({
      event: writtenAsBuilt(events[seq] as CatalogEvent),
      tail: tailId,
      seq,
      prev,
    });
    hashes.push(prev);
  }
  return hashes;
}

/** The second reader's notes, by their words. */
function secondNotes(): readonly string[] {
  return secondReading(root)
    .findings.filter((f) => f.level === 'note')
    .map((f) => `${f.section}: ${f.what} (${f.where})`);
}

describe('the two readers agree on the order a citation gives: a machine whose clock is behind', () => {
  /**
   * A enrols B at second 5 by A's clock. B pulls, and writes at second 1 by its own, which is
   * behind: the honest record of a second machine with a slow clock (the probe on the binary
   * reproduced it with B 31 s behind). Ordered by `at` alone, B's event comes before the
   * enrolment that authorizes it.
   */
  function enrolledThenWrittenBehind(after?: 'cite' | readonly string[], second = 1) {
    const a = generateKeyPair();
    const b = generateKeyPair();
    commitPublicKey(a);
    commitPublicKey(b);
    const anchor = deriveAnchor(a.fingerprint);
    const tailA = `${a.fingerprint}-i1`;
    const onA = [founding(a), enrolled(anchor, a, b, 5)];
    const [, enrolment] = entryHashesOf(tailA, onA);
    writeTail(tailA, onA, a);
    const cited = after === 'cite' ? [enrolment as string] : after;
    const behind = taskCreated(
      {
        at: at(second),
        who: anchor,
        signerFp: b.fingerprint,
        subject: 't-behind',
        ...(cited === undefined ? {} : { after: cited }),
      },
      { title: 'written on B, after the pull' },
    );
    writeTail(`${b.fingerprint}-i2`, [behind], b);
    return { a, b, enrolment: enrolment as string, tailA, tailB: `${b.fingerprint}-i2` };
  }

  it('R7: over any skew, citing the enrolment is verified by both, and not citing is what `at` alone says', () => {
    const outer = root;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), fc.boolean(), (second, cite) => {
        root = mkdtempSync(join(tmpdir(), 'mnema-two-readers-r7-'));
        try {
          const { tailA, tailB } = enrolledThenWrittenBehind(cite ? 'cite' : undefined, second);
          // The enrolment is at second 5. Uncited, B's event follows it only when its `at` is
          // later, or ties and B's tail id sorts after A's: the order of before citations.
          const byAt = second > 5 || (second === 5 && tailA < tailB);
          const expected = cite || byAt;
          const { productOk, verdict } = bothReaders();
          expect(productOk).toBe(expected);
          expect(verdict).toBe(expected ? 'VERIFIED' : 'REFUSED');
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { seed: Number(process.env.FC_SEED ?? 20_261_007), numRuns: 16 },
    );
    root = outer;
  });

  it('without a citation: refused by both, because `at` puts the event before its enrolment', () => {
    enrolledThenWrittenBehind();
    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(productRefused().join('\n')).toContain('is not a key enrolled for');
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('6.2');
  });

  it('citing the enrolment it was written on top of: verified by both, whatever the clock said', () => {
    enrolledThenWrittenBehind('cite');
    const { productOk, verdict, refused } = bothReaders();
    expect(refused).toEqual([]);
    expect(productOk).toBe(true);
    expect(verdict).toBe('VERIFIED');
  });

  it('the clock that ran behind what it cites is measured and said, informational, by both', () => {
    const { tailB } = enrolledThenWrittenBehind('cite');
    const census = verify(root, catalogUpcasters()).census;
    expect(census.filter((note) => note.kind === 'clock-behind-what-it-read')).toMatchObject([
      { tail: tailB, events: 1, behindByMs: 4_000 },
    ]);
    expect(secondNotes().join('\n')).toMatch(/clock .*behind.* 4\.000 s/);
  });

  it('a citation of an entry the record does not hold: ignored in the order, said by both', () => {
    const missing = 'f'.repeat(64);
    const { tailB } = enrolledThenWrittenBehind([missing]);
    // Ignored: B's event stays where its `at` puts it, before the enrolment, and is refused
    // exactly as an event with no citation is; the citation neither helps nor breaks.
    const { productOk, verdict } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    const census = verify(root, catalogUpcasters()).census;
    expect(census.filter((note) => note.kind === 'citation-not-held')).toMatchObject([
      { tail: tailB, seq: 0, hash: missing },
    ]);
    expect(secondNotes().join('\n')).toContain(`cites ${missing.slice(0, 12)}`);
  });

  it.each([
    ['empty', []],
    ['out of order', ['b'.repeat(64), 'a'.repeat(64)]],
    ['repeated', ['a'.repeat(64), 'a'.repeat(64)]],
    ['upper-case hex', ['A'.repeat(64)]],
    ['63 characters', ['a'.repeat(63)]],
  ])('a citation list that is %s: refused by both', (_name, after) => {
    enrolledThenWrittenBehind(after);
    const { productOk, verdict, refused } = bothReaders();
    expect(productOk).toBe(false);
    expect(verdict).toBe('REFUSED');
    expect(refused.join('\n')).toContain('4.1');
  });
});
