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
import { runEnded, runStarted, taskCreated, taskTransitioned } from './build.js';
import type { CatalogEvent } from './catalog.js';

const digest = (event: CatalogEvent): string =>
  createHash('sha256').update(eventBytes(event)).digest('hex');

const env = {
  at: '2026-07-21T00:00:00.000Z',
  who: 'alice',
  which: 'claude',
  subject: 't-1',
};

/** Each vector: a fixed event and the SHA-256 of its canonical bytes. */
const vectors: ReadonlyArray<{ name: string; event: CatalogEvent; sha256: string }> = [
  {
    name: 'task.created',
    event: taskCreated(env, { title: 'Ship the parser' }),
    sha256: '2eccab82f93fed127228a63ecf780f612bdad214fae4a1b9b29640e417980141',
  },
  {
    name: 'task.transitioned (birth, from: null)',
    event: taskTransitioned(env, { from: null, to: 'todo', action: 'create' }),
    sha256: 'ad32a907572d507abb66c208bf57e582f071896e07001dec15f766d9b5fefd7c',
  },
  {
    name: 'task.transitioned (with proof fields)',
    event: taskTransitioned(env, {
      from: 'todo',
      to: 'done',
      action: 'finish',
      fields: { note: 'shipped', pr_url: 'https://example.test/pr/1' },
    }),
    sha256: '6c55519a0d9818605f370304beb23c41009ad529394507d1a5de52795491db3a',
  },
  {
    name: 'run.started',
    event: runStarted(
      { at: '2026-07-21T00:00:00.000Z', who: 'alice', subject: 'r-1' },
      { agent: 'claude', goal: 'do the thing' },
    ),
    sha256: '6be8a7c9854e5923e8268c405610a84b8fbf5d48fb04f22ba336920ca119a6a6',
  },
  {
    name: 'run.ended',
    event: runEnded(
      { at: '2026-07-21T00:00:00.000Z', who: 'alice', subject: 'r-1' },
      {
        outcome: 'ok',
      },
    ),
    sha256: 'b87ed8d1b45f93a5f9dbdf5102ea0efc93e67f1ebef2ea821dfb90f09cbc5173',
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
    expect(digest(nfd)).toBe('17488a009921589727c7ef462c1673cbb7858314e54ea23aea06fd7ebc6c0508');
  });
});
