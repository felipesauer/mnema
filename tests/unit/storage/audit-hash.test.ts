import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * Locks the single source of truth for the audit chain's per-line hash.
 * The writer seals each line with `hashEvent`, and the verifier
 * (`inspectAuditIntegrity`) recomputes with the SAME function; if the two
 * ever diverged, every already-written line would falsely read as
 * tampered (or a forged line could verify). These tests pin the exact
 * canonicalisation to a golden digest and assert the writer and verifier
 * paths are one implementation, not two.
 */
describe('hashEvent', () => {
  const representative: AuditEvent = {
    v: 2,
    at: '2026-07-03T00:00:00.000Z',
    kind: 'task_transitioned',
    actor: 'felipesauer',
    via: 'claude-code',
    run: '019f0000-0000-7000-8000-000000000000',
    data: { from: 'READY', to: 'IN_PROGRESS', nested: { a: 1, b: [2, 3] } },
    prev_hash: 'abc123',
    hash: 'SHOULD_BE_OMITTED',
  };

  it('pins the canonical digest of a representative event to a golden hex', () => {
    // Golden value computed from the shared implementation. If this test
    // fails after a change to hashEvent, the change alters the hash of
    // EVERY historical line — it must be a deliberate, versioned migration.
    expect(hashEvent(representative)).toBe(
      '57c9bce8c28b3d12eab8996e5c9f43092ba80b02e8c376d239e97f3b3b6882c4',
    );
  });

  it('omits the `hash` field so a sealed and unsealed event share a digest', () => {
    const { hash: _stray, ...unsealed } = representative;
    expect(hashEvent(representative)).toBe(hashEvent(unsealed as AuditEvent));
  });

  it('is byte-identical to a from-scratch SHA-256 over the hash-omitted event', () => {
    // Mirrors what the verifier used to inline. Proves the shared function
    // reproduces the canonicalisation exactly — the guard against a silent
    // divergence between writer and verifier.
    const { hash: _omit, ...rest } = representative;
    const fromScratch = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(hashEvent(representative)).toBe(fromScratch);
  });

  it('handles an event with no optional fields', () => {
    const minimal: AuditEvent = {
      v: 2,
      at: '2026-07-03T00:00:00.000Z',
      kind: 'note_added',
      actor: 'felipesauer',
      data: {},
    };
    const { ...rest } = minimal;
    const expected = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(hashEvent(minimal)).toBe(expected);
  });

  it('handles a genesis line with prev_hash null', () => {
    const genesis: AuditEvent = {
      v: 2,
      at: '2026-07-03T00:00:00.000Z',
      kind: 'project_initialised',
      actor: 'felipesauer',
      data: { key: 'MNEMA' },
      prev_hash: null,
    };
    const { hash: _o, ...rest } = genesis;
    const expected = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(hashEvent(genesis)).toBe(expected);
  });
});
