/**
 * Operating the roster: what must be refused BEFORE it becomes a fact.
 *
 * An enrollment and a revocation are append-only, so the interesting cases are
 * the ones that never reach the record. A vouch for a key that consented to
 * another identity would leave the tree permanently failing verification; a vouch
 * signed by a key the identity retired would too; retiring the last key would
 * leave an identity that can never sign anything again, including its own repair.
 * Each of those costs one refusal here and cannot be undone there.
 *
 * The whole flow is driven the way the surface drives it — the joining machine
 * makes a real request, a member reads it — so nothing is asserted about material
 * assembled by the test that the real path would not produce.
 */

import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  deriveAnchor,
  openChainForWriting,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { requestEnrollment } from './handshake.js';
import { rosterOf } from './membership.js';
import { enrollFromRequest, revokeMember } from './roster.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-roster-tree-');
  tick = 0;
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-07-27T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

interface Machine {
  readonly keyRoot: string;
  readonly writer: ChainWriter;
  readonly ctx: WriteContext;
  readonly fingerprint: string;
}

function machine(prefix: string): Machine {
  return open(tmp(prefix));
}

function open(keyRoot: string): Machine {
  const writer = openChainForWriting(tree, { keyRoot });
  const layout: ChainLayout = { root: tree };
  return {
    keyRoot,
    writer,
    ctx: { writer, layout, upcasters, clock },
    fingerprint: writer.signerFingerprint,
  };
}

/** The request a joining machine hands over — produced by the real operation. */
function requestOf(m: Machine, anchor: string): string {
  const made = requestEnrollment({ anchor, keyRoot: m.keyRoot });
  if (!made.ok) throw new Error(`the test could not make a request: ${made.code}`);
  return made.request;
}

/** How many facts of one kind the record carries. */
function count(kind: string): number {
  return orderedEvents({ root: tree }, upcasters).filter((e) => e.kind === kind).length;
}

describe('enrollFromRequest — a key joins by a member vouching for it', () => {
  it('commits the public half and appends the vouch, and the joining key then writes as the identity', () => {
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    // B has never written here, so nothing of B is in the tree yet — except the
    // public half its writer materialized on open. Remove it, so the enrollment is
    // what puts the proof material in the tree, as it must for a machine that has
    // only ever run `key request`.
    unlinkSync(join(tree, 'keys', `${b.fingerprint}.pub`));

    const enrolled = enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });

    expect(enrolled).toEqual({
      ok: true,
      fingerprint: b.fingerprint,
      anchor,
      alreadyMember: false,
    });
    // The public half is committed — without it the verifier cannot prove the
    // consent the fact rests on, and the enrollment would be permanently rejected.
    expect(existsSync(join(tree, 'keys', `${b.fingerprint}.pub`))).toBe(true);
    expect(count('key.enrolled')).toBe(1);
    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([a.fingerprint, b.fingerprint]));

    // And the point of it all: B writes as A's identity, not one of its own.
    const bMember = open(b.keyRoot);
    expect(captureMemory(bMember.ctx, { content: 'from the second machine' }).ok).toBe(true);
    bMember.writer.checkpoint();
    const memory = orderedEvents({ root: tree }, upcasters).find(
      (e) => e.kind === 'memory.captured',
    );
    expect(memory?.who).toBe(anchor);
    expect(memory?.signerFp).toBe(b.fingerprint);
    expect(count('identity.founded')).toBe(1);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
  });

  it('refuses UNPROVEN_REQUEST for a request made for ANOTHER identity', () => {
    // The refusal that matters most: the consent covers `enroll:<anchor>:<fp>`, so a
    // request made for someone else is not consent to join this identity. Appending
    // it would leave the tree carrying an enrollment its own verifier rejects, for
    // good — so it is refused while refusing is still free.
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    const elsewhere = deriveAnchor('f'.repeat(64));

    const refused = enrollFromRequest(a.ctx, { request: requestOf(b, elsewhere) });

    expect(refused).toMatchObject({ ok: false, code: 'UNPROVEN_REQUEST' });
    expect((refused as { message: string }).message).toContain(anchor);
    expect((refused as { message: string }).message).toContain(b.fingerprint);
    expect(count('key.enrolled')).toBe(0);
  });

  it('refuses MALFORMED_REQUEST without writing anything', () => {
    const a = machine('mnema-roster-a-');
    ensureFounded(a.ctx);

    for (const text of ['', 'not a request', 'mnema-key-request:1:zzzz']) {
      expect(enrollFromRequest(a.ctx, { request: text })).toMatchObject({
        ok: false,
        code: 'MALFORMED_REQUEST',
      });
    }
    expect(count('key.enrolled')).toBe(0);
  });

  it('reports a key that is ALREADY a member instead of saying it twice', () => {
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    const request = requestOf(b, anchor);
    expect(enrollFromRequest(a.ctx, { request }).ok).toBe(true);

    const again = enrollFromRequest(a.ctx, { request });

    expect(again).toEqual({ ok: true, fingerprint: b.fingerprint, anchor, alreadyMember: true });
    // A second enrollment fact would say nothing new, so none was appended.
    expect(count('key.enrolled')).toBe(1);
  });

  it('refuses CANNOT_VOUCH from a machine the identity retired', () => {
    // A retired key's vouch would be rejected by the verifier ("signed by a key not
    // valid for the anchor"), so the fact must not exist. The person is told where
    // to run it instead.
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    expect(enrollFromRequest(a.ctx, { request: requestOf(b, anchor) }).ok).toBe(true);
    // B, a member, retires A.
    const bMember = open(b.keyRoot);
    expect(
      revokeMember(bMember.ctx, { fingerprint: a.fingerprint, reason: 'rotated out' }).ok,
    ).toBe(true);

    const c = machine('mnema-roster-c-');
    const refused = enrollFromRequest(a.ctx, { request: requestOf(c, anchor) });

    expect(refused).toMatchObject({ ok: false, code: 'CANNOT_VOUCH' });
    expect((refused as { message: string }).message).toContain('still a member');
    expect(count('key.enrolled')).toBe(1);
    // And from B, which IS a member, the same request goes through.
    expect(enrollFromRequest(bMember.ctx, { request: requestOf(c, anchor) }).ok).toBe(true);
  });

  it('vouches from a tree with no founding yet — the first write founds and enrolls', () => {
    // A machine may enroll into an identity it is about to found: it becomes that
    // identity's only member in the same breath, so the vouch is sound.
    const a = machine('mnema-roster-a-');
    const b = machine('mnema-roster-b-');
    const anchor = deriveAnchor(a.fingerprint);

    const enrolled = enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });

    expect(enrolled).toMatchObject({ ok: true, anchor });
    expect(count('identity.founded')).toBe(1);
    expect(count('key.enrolled')).toBe(1);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
  });
});

describe('revokeMember — a key leaves, and the last one cannot', () => {
  it('retires a peer, prospectively: its earlier facts stay, its later ones do not', () => {
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });
    const bMember = open(b.keyRoot);
    captureMemory(bMember.ctx, { content: 'written while a member' });

    const revoked = revokeMember(a.ctx, { fingerprint: b.fingerprint, reason: 'laptop stolen' });

    expect(revoked).toEqual({
      ok: true,
      fingerprint: b.fingerprint,
      anchor,
      self: false,
      remaining: 1,
    });
    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([a.fingerprint]));
    // What B wrote while a member is still valid: a revocation is not retroactive.
    a.writer.checkpoint();
    bMember.writer.checkpoint();
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
  });

  it('retires the key of the very machine running it, and the tree stays verifiable', () => {
    // Decommissioning this machine while another member remains. The record stays
    // green — the revocation is prospective and its own checkpoint covers it — and
    // the caller is told it was its own key so it can stop writing here.
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });

    const revoked = revokeMember(a.ctx, {
      fingerprint: a.fingerprint,
      reason: 'this machine is being decommissioned',
    });

    expect(revoked).toMatchObject({ ok: true, self: true, remaining: 1 });
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
    // The remaining member carries on under the same identity.
    const bMember = open(b.keyRoot);
    expect(captureMemory(bMember.ctx, { content: 'B carries on' }).ok).toBe(true);
    bMember.writer.checkpoint();
    const authors = new Set(orderedEvents({ root: tree }, upcasters).map((e) => e.who));
    expect(authors).toEqual(new Set([anchor]));
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
  });

  it('refuses LAST_KEY — an identity with no keys can never be repaired', () => {
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);

    const refused = revokeMember(a.ctx, { fingerprint: a.fingerprint, reason: 'done with it' });

    expect(refused).toMatchObject({ ok: false, code: 'LAST_KEY' });
    // The remedy is stated, because the order is what makes it possible at all.
    expect((refused as { message: string }).message).toContain('Enroll the replacement');
    expect(count('key.revoked')).toBe(0);
    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([a.fingerprint]));

    // With a second key in, the same revocation goes through.
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });
    expect(revokeMember(a.ctx, { fingerprint: a.fingerprint, reason: 'done with it' }).ok).toBe(
      true,
    );
  });

  it('refuses UNKNOWN_KEY for a key this identity never had, or already retired', () => {
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });

    const stranger = 'e'.repeat(64);
    expect(revokeMember(a.ctx, { fingerprint: stranger, reason: 'suspicious' })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_KEY',
    });

    expect(revokeMember(a.ctx, { fingerprint: b.fingerprint, reason: 'gone' }).ok).toBe(true);
    // Retiring it twice says nothing new, and the message covers both readings.
    const again = revokeMember(a.ctx, { fingerprint: b.fingerprint, reason: 'gone again' });
    expect(again).toMatchObject({ ok: false, code: 'UNKNOWN_KEY' });
    expect((again as { message: string }).message).toContain('retired already');
    expect(count('key.revoked')).toBe(1);
  });

  it('refuses CANNOT_VOUCH from a retired machine — a revocation it signed would not take', () => {
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });
    const bMember = open(b.keyRoot);
    revokeMember(bMember.ctx, { fingerprint: a.fingerprint, reason: 'rotated out' });

    const refused = revokeMember(a.ctx, { fingerprint: b.fingerprint, reason: 'retaliation' });

    expect(refused).toMatchObject({ ok: false, code: 'CANNOT_VOUCH' });
    expect(count('key.revoked')).toBe(1);
  });
});

describe('rosterOf — the count that LAST_KEY rests on', () => {
  it('does not count an enrollment the verifier would reject', () => {
    // An enrollment whose public half never reached the tree cannot be proven, so
    // the verifier rejects it. Counting it here would let the last REAL key be
    // retired on the strength of a key that cannot sign.
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });
    expect(rosterOf({ tree, upcasters }, anchor).size).toBe(2);

    unlinkSync(join(tree, 'keys', `${b.fingerprint}.pub`));

    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([a.fingerprint]));
    // And with the roster back down to one, retiring it is refused again.
    expect(
      revokeMember(a.ctx, { fingerprint: a.fingerprint, reason: 'not so fast' }),
    ).toMatchObject({ ok: false, code: 'LAST_KEY' });
  });
});

describe('a retired key coming back — the one addition the verifier gates', () => {
  it('re-enrolls it under coverage, so the record takes it back instead of ignoring it', () => {
    // The verifier treats an addition that RESTORES a key revoked under signature
    // coverage exactly as it treats the revoke: it takes effect only when it is
    // itself covered, or a keyless party could plant a residual re-enroll and
    // silently undo a signed removal. A legitimate re-enrollment therefore has to
    // prove itself at once — which is why the operation checkpoints. Without that,
    // this would leave the key named as a member and NOT valid: an issue in the
    // record and a machine that cannot write.
    const a = machine('mnema-roster-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-roster-b-');
    enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });
    revokeMember(a.ctx, { fingerprint: b.fingerprint, reason: 'laptop misplaced' });
    expect(rosterOf({ tree, upcasters }, anchor).has(b.fingerprint)).toBe(false);

    const back = enrollFromRequest(a.ctx, { request: requestOf(b, anchor) });

    expect(back).toMatchObject({ ok: true, alreadyMember: false });
    expect(rosterOf({ tree, upcasters }, anchor).has(b.fingerprint)).toBe(true);
    // The verifier agrees — no residual, no issue: the key writes again as the same
    // identity, and the whole record still verifies.
    const bMember = open(b.keyRoot);
    expect(captureMemory(bMember.ctx, { content: 'found it again' }).ok).toBe(true);
    bMember.writer.checkpoint();
    const verdict = verify(tree, upcasters);
    expect(verdict).toMatchObject({ ok: true, fullySigned: true });
    expect(verdict.issues).toEqual([]);
    const authors = new Set(orderedEvents({ root: tree }, upcasters).map((e) => e.who));
    expect(authors).toEqual(new Set([anchor]));
  });
});
