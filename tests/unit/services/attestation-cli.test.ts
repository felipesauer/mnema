import { describe, expect, it } from 'vitest';
import { chainHealthyForAttest } from '@/services/audit/attestation-cli.js';
import type { IntegrityCheck } from '@/services/integrity/audit-integrity.js';

/**
 * chainHealthyForAttest is the gate that closes the truncation-laundering gap:
 * a truncated tail surfaces as a WARNING-severity 'audit event count' / 'audit
 * hash chain' check, and a naive every(severity !== 'error') would bless it.
 * This gate must block on those warnings, not just errors.
 */
describe('chainHealthyForAttest', () => {
  const check = (name: string, ok: boolean, severity: 'error' | 'warning'): IntegrityCheck => ({
    name,
    ok,
    detail: '',
    severity,
  });

  it('is healthy when all chain-soundness checks pass', () => {
    expect(
      chainHealthyForAttest([
        check('audit event count', true, 'error'),
        check('audit hash chain', true, 'error'),
        check('audit authenticity', false, 'warning'), // unrelated warning is fine
      ]),
    ).toBe(true);
  });

  it('BLOCKS on a warning-severity count check (truncated last line)', () => {
    // This is the exact shape the review flagged: a one-ahead truncation is a
    // warning, not an error. It must still block reattest.
    expect(
      chainHealthyForAttest([
        check('audit event count', false, 'warning'),
        check('audit hash chain', true, 'error'),
      ]),
    ).toBe(false);
  });

  it('BLOCKS on a warning-severity hash-chain check', () => {
    expect(chainHealthyForAttest([check('audit hash chain', false, 'warning')])).toBe(false);
  });

  it('blocks on an error-severity chain check', () => {
    expect(chainHealthyForAttest([check('audit hash chain', false, 'error')])).toBe(false);
  });

  it('ignores non-chain checks (authenticity/downgrade are not soundness)', () => {
    expect(
      chainHealthyForAttest([
        check('audit authenticity', false, 'warning'),
        check('audit downgrade anchor', false, 'warning'),
      ]),
    ).toBe(true);
  });

  it('BLOCKS on an error whose name is outside the soundness set', () => {
    // The audit_state-row-missing early return emits a lone 'audit integrity'
    // error and returns before the count/hash checks run. A name-only allowlist
    // would pass it (fail-open); blocking on any error catches it.
    expect(chainHealthyForAttest([check('audit integrity', false, 'error')])).toBe(false);
  });

  it('does not block on a benign ok:true audit-integrity check (legacy/no-dir)', () => {
    expect(chainHealthyForAttest([check('audit integrity', true, 'warning')])).toBe(true);
  });
});
