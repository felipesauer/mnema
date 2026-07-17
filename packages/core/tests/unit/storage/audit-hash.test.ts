import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hmacEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * Locks the single source of truth for the audit chain's per-line hash.
 * The writer seals each line with `hmacEvent`, and the verifier
 * (`inspectAuditIntegrity`) recomputes with the SAME function; if the two
 * ever diverged, every already-written line would falsely read as
 * tampered (or a forged line could verify). These tests pin the exact
 * canonicalisation to a golden digest and assert the writer and verifier
 * paths are one implementation, not two.
 */
describe('hmacEvent', () => {
  const secret = Buffer.from(
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    'hex',
  );
  const event: AuditEvent = {
    v: 1,
    at: '2026-07-03T00:00:00.000Z',
    kind: 'task_transitioned',
    actor: 'felipesauer',
    via: 'claude-code',
    run: '019f0000-0000-7000-8000-000000000000',
    data: { from: 'READY', to: 'IN_PROGRESS', nested: { a: 1, b: [2, 3] } },
    prev_hash: 'abc123',
    hash: 'SHOULD_BE_OMITTED',
  };

  it('pins the keyed digest to a golden hex', () => {
    expect(hmacEvent(event, secret)).toBe(
      '404338a0a77b421c8c93b3ab12380b476bd99c8f0f3dcbd353e2533abab7bfcd',
    );
  });

  it('is byte-identical to a from-scratch HMAC over the hash-omitted event', () => {
    const { hash: _omit, ...rest } = event;
    const fromScratch = createHmac('sha256', secret).update(JSON.stringify(rest)).digest('hex');
    expect(hmacEvent(event, secret)).toBe(fromScratch);
  });

  it('omits the `hash` field from the digest input', () => {
    const { hash: _stray, ...unsealed } = event;
    expect(hmacEvent(event, secret)).toBe(hmacEvent(unsealed as AuditEvent, secret));
  });

  it('a wrong secret yields a different digest (authenticity depends on the key)', () => {
    const wrong = Buffer.from(`ff`.repeat(32), 'hex');
    expect(hmacEvent(event, wrong)).not.toBe(hmacEvent(event, secret));
  });
});
