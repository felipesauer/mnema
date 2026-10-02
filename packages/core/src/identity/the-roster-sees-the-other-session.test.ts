/**
 * Two changes of one roster, by two sessions of one installation: the second judges the roster
 * the first left.
 *
 * `key revoke` and `key enroll` decide on the roster — the last key may not go, a retired key
 * may not vouch, a member is not enrolled twice — and they read it before the tail's lock was
 * taken. Two revocations of the two keys of a two-key identity, run together, each read two
 * keys, each passed the last-key refusal, and the identity was left with none: the one state of
 * the roster with no way back.
 *
 * Not a race, for the reason `workflow/the-second-move-sees-the-first.test.ts` gives: the
 * hazard is the stale reading, and the case produces it every time by running the other
 * session's whole change right after this session's roster was read. The roster is read
 * through `rosterOf`, so that is where the other session is let in.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, openChainForWriting, verify } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { requestEnrollment } from './handshake.js';
import { IdentityUnavailableError, rosterOf } from './membership.js';
import { enrollFromRequest, revokeMember } from './roster.js';

const race = vi.hoisted(() => ({
  other: undefined as (() => void) | undefined,
  inOther: false,
}));

vi.mock('./membership.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./membership.js')>();
  return {
    ...real,
    rosterOf: (...args: Parameters<typeof real.rosterOf>): Set<string> => {
      const reading = real.rosterOf(...args);
      const other = race.other;
      if (other !== undefined && !race.inOther) {
        race.other = undefined;
        race.inOther = true;
        try {
          other();
        } finally {
          race.inOther = false;
        }
      }
      return reading;
    },
  };
});

const upcasters = catalogUpcasters();
let dirs: string[] = [];
let tree: string;
let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-10-01T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  dirs = [];
  tick = 0;
  race.other = undefined;
  tree = tmp('mnema-roster-race-');
});

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A session writing the tree with the key at `keyRoot`. Two sessions of one key share a tail. */
function session(keyRoot: string): WriteContext {
  const writer = openChainForWriting(tree, { keyRoot });
  const layout: ChainLayout = { root: tree };
  return { writer, layout, upcasters, clock };
}

/** An identity founded by key A, with key B enrolled: the two-key roster. */
function twoKeys(): { a: string; anchor: string; aFp: string; bFp: string; bRoot: string } {
  const a = tmp('mnema-roster-race-a-');
  const first = session(a);
  const anchor = ensureFounded(first);
  const bRoot = tmp('mnema-roster-race-b-');
  const request = requestEnrollment({ anchor, keyRoot: bRoot });
  if (!request.ok) throw new Error(`setup: ${request.code}`);
  const joined = enrollFromRequest(first, { request: request.request });
  if (!joined.ok) throw new Error(`setup: ${joined.code}`);
  return { a, anchor, aFp: first.writer.signerFingerprint, bFp: joined.fingerprint, bRoot };
}

function whileThisRosterIsInFlight(other: () => void): void {
  race.other = other;
}

describe('two revocations of one roster', () => {
  it('the second of two revocations that would leave no key is refused LAST_KEY', () => {
    const { a, anchor, aFp, bFp } = twoKeys();
    let first: ReturnType<typeof revokeMember> | undefined;
    whileThisRosterIsInFlight(() => {
      first = revokeMember(session(a), { fingerprint: bFp, reason: 'rotated out' });
    });
    const second = revokeMember(session(a), { fingerprint: aFp, reason: 'rotated out too' });

    expect(first).toMatchObject({ ok: true, remaining: 1 });
    expect(second).toMatchObject({ ok: false, code: 'LAST_KEY' });
    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([aFp]));
    expect(verify(tree, upcasters).ok).toBe(true);
  });

  it('the second revocation of one key finds it retired already', () => {
    const { a, anchor, aFp, bFp } = twoKeys();
    let first: ReturnType<typeof revokeMember> | undefined;
    whileThisRosterIsInFlight(() => {
      first = revokeMember(session(a), { fingerprint: bFp, reason: 'rotated out' });
    });
    const second = revokeMember(session(a), { fingerprint: bFp, reason: 'and again' });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, code: 'UNKNOWN_KEY' });
    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([aFp]));
  });
});

describe('an enrollment beside a change of the roster', () => {
  it('a key enrolled a moment ago by another session is a member already — one vouch, not two', () => {
    const a = tmp('mnema-roster-race-a-');
    const anchor = ensureFounded(session(a));
    const bRoot = tmp('mnema-roster-race-b-');
    const request = requestEnrollment({ anchor, keyRoot: bRoot });
    if (!request.ok) throw new Error(`setup: ${request.code}`);
    let first: ReturnType<typeof enrollFromRequest> | undefined;
    whileThisRosterIsInFlight(() => {
      first = enrollFromRequest(session(a), { request: request.request });
    });
    const second = enrollFromRequest(session(a), { request: request.request });

    expect(first).toMatchObject({ ok: true, alreadyMember: false });
    expect(second).toMatchObject({ ok: true, alreadyMember: true });
    const vouches = rosterOf({ tree, upcasters }, anchor);
    expect(vouches.size).toBe(2);
  });

  it('a key retired a moment ago by another session can no longer vouch', () => {
    const { a, anchor, aFp, bFp, bRoot } = twoKeys();
    const cRoot = tmp('mnema-roster-race-c-');
    const request = requestEnrollment({ anchor, keyRoot: cRoot });
    if (!request.ok) throw new Error(`setup: ${request.code}`);
    whileThisRosterIsInFlight(() => {
      // From A's machine, B is retired while B's own session is vouching for C.
      revokeMember(session(a), { fingerprint: bFp, reason: 'lost laptop' });
    });
    // Refused the way a retired key is refused whenever it writes: the record no longer counts
    // it, and a vouch it signed would leave the record failing verification for good. This one
    // held before the roster was judged under the lock too — every write asks whether its
    // identity still counts its key — so it is a witness that the lock left it as it was, not
    // a case the lock made pass.
    expect(() => enrollFromRequest(session(bRoot), { request: request.request })).toThrow(
      IdentityUnavailableError,
    );
    expect(rosterOf({ tree, upcasters }, anchor)).toEqual(new Set([aFp]));
    expect(verify(tree, upcasters).ok).toBe(true);
  });
});
