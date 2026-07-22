/**
 * Golden vectors for canonicalization.
 *
 * The property tests next door prove canonicalization is deterministic,
 * key-sorted, and Unicode-normalized. They do NOT pin the ACTUAL bytes: a
 * refactor could change the byte layout while keeping every property intact,
 * and every existing test would stay green — silently breaking the ability of
 * an older clone (or a signed checkpoint) to reproduce the same content root.
 *
 * These vectors freeze the exact SHA-256 of the canonical bytes for a
 * representative event of every kind. If one changes, the canonical format
 * changed: the diff has to be a deliberate, versioned migration, never an
 * accident. This is the regression floor under the whole proof — the signature
 * is over these bytes.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { eventBytes } from '../chain/hash.js';
import {
  decisionRecorded,
  decisionTransitioned,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  runEnded,
  runStarted,
  taskCreated,
  taskTransitioned,
} from './build.js';
import type { CatalogEvent } from './catalog.js';

const digest = (event: CatalogEvent): string =>
  createHash('sha256').update(eventBytes(event)).digest('hex');

// `who` is an anchor id (`mnid:<hash>`) and `signerFp` a full key fingerprint —
// both are fixed here so the frozen digests pin the real envelope shape, the one
// an operation derives from its key, not a placeholder.
const WHO = 'mnid:1111111111111111111111111111111111111111111111111111111111111111';
const SIGNER_FP = '2222222222222222222222222222222222222222222222222222222222222222';
const NEW_FP = '3333333333333333333333333333333333333333333333333333333333333333';

const env = {
  at: '2026-07-21T00:00:00.000Z',
  who: WHO,
  signerFp: SIGNER_FP,
  which: 'claude',
  subject: 't-1',
};

/** Each vector: a fixed event and the SHA-256 of its canonical bytes. */
const vectors: ReadonlyArray<{ name: string; event: CatalogEvent; sha256: string }> = [
  {
    name: 'task.created',
    event: taskCreated(env, { title: 'Ship the parser' }),
    sha256: 'e645a47c2c0a6370e607246f67c5b3040b5a97c9977eb21fb66d894696f6751b',
  },
  {
    name: 'task.transitioned (birth, from: null)',
    event: taskTransitioned(env, { from: null, to: 'todo', action: 'create' }),
    sha256: '17d68fa59a2c6206ee717da2e2e2516a9ca6237905110727aff6de379f96e7e2',
  },
  {
    name: 'task.transitioned (with proof fields)',
    event: taskTransitioned(env, {
      from: 'todo',
      to: 'done',
      action: 'finish',
      fields: { note: 'shipped', pr_url: 'https://example.test/pr/1' },
    }),
    sha256: '8bf3ac330c91a56d138fa28e31973c3b161ede06704c7201af6daf9cb86a6bba',
  },
  {
    name: 'run.started',
    event: runStarted(
      { at: '2026-07-21T00:00:00.000Z', who: WHO, signerFp: SIGNER_FP, subject: 'r-1' },
      { agent: 'claude', goal: 'do the thing' },
    ),
    sha256: 'dceb41f6f35480826487ddcea67a3dd5c376d39ada91bd1dba34386bc26a4165',
  },
  {
    name: 'run.ended',
    event: runEnded(
      { at: '2026-07-21T00:00:00.000Z', who: WHO, signerFp: SIGNER_FP, subject: 'r-1' },
      {
        outcome: 'ok',
      },
    ),
    sha256: '814c119819392bc9069e9ce8178ef7efaa84a0379103c3ba5af6ab7d0c4661aa',
  },
  {
    name: 'decision.recorded',
    event: decisionRecorded(
      {
        at: '2026-07-21T00:00:00.000Z',
        who: WHO,
        signerFp: SIGNER_FP,
        which: 'claude',
        subject: 'd-1',
      },
      { title: 'Use SQLite for the cache', rationale: 'The load is relational.', adr: 'ADR-3' },
    ),
    sha256: 'ea7fb49e4f83e30414fdea73303ef309f2322000223229d93826a4b92da99d47',
  },
  {
    name: 'decision.transitioned (supersede, with `by`)',
    event: decisionTransitioned(
      {
        at: '2026-07-21T00:00:00.000Z',
        who: WHO,
        signerFp: SIGNER_FP,
        which: 'claude',
        subject: 'd-1',
      },
      {
        from: 'accepted',
        to: 'superseded',
        action: 'supersede',
        by: 'd-2',
        fields: { reason: 'r' },
      },
    ),
    sha256: '24793d2e053cad92ed0d0364ba8f6a8d51b004507a37a645cabbb54ba4012700',
  },
  {
    // The enrollment kinds' subject is the anchor (`mnid:<hash>`), not a task or
    // decision id, and they carry no `which` — they are identity facts, not agent
    // work. Freezing their bytes pins that shape so an enrollment written now
    // stays reproducible by a clone that verifies the fold later.
    name: 'identity.founded (self-signed by the founder)',
    event: identityFounded(
      { at: '2026-07-21T00:00:00.000Z', who: WHO, signerFp: SIGNER_FP, subject: WHO },
      { foundingFp: SIGNER_FP },
    ),
    sha256: '40472210b699781d13c49f550047f2b746ceff42a64accde156187a16a265499',
  },
  {
    name: 'key.enrolled (member vouches for a new key)',
    event: keyEnrolled(
      { at: '2026-07-21T00:00:00.000Z', who: WHO, signerFp: SIGNER_FP, subject: WHO },
      { newFp: NEW_FP, reverseSig: 'ab'.repeat(32) },
    ),
    sha256: '4f4b32213a25ebf59e682941bfa28614c92f915addca5288ebdfb241aaa05a5a',
  },
  {
    name: 'key.revoked (prospective removal)',
    event: keyRevoked(
      { at: '2026-07-21T00:00:00.000Z', who: WHO, signerFp: SIGNER_FP, subject: WHO },
      { revokedFp: NEW_FP, reason: 'key rotation' },
    ),
    sha256: 'f7f9b5dc090d11a8a909cc2d8cf32327fda764e1762add37874a90e11a1d394b',
  },
];

describe('canonicalization golden vectors — the byte format must not drift silently', () => {
  for (const { name, event, sha256 } of vectors) {
    it(`${name} hashes to its frozen digest`, () => {
      expect(digest(event)).toBe(sha256);
    });
  }

  it('normalizes an NFD title to the same bytes as its NFC form (a fixed digest)', () => {
    // "cafe\u0301" written decomposed (e + U+0301 combining acute) must canonicalize
    // to the same bytes — and thus the same digest — as the composed form. The
    // frozen hash pins the normalized result, so a change to normalization is a
    // change to the format, caught here.
    const nfd = taskCreated({ ...env, subject: 't-2' }, { title: 'café' });
    expect(digest(nfd)).toBe('7d301648812a6079f0f480a487ffb8dd36800e82c9828acfb5b46ca4f8b23b20');
  });
});
