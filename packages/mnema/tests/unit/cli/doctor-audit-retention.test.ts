import { describe, expect, it } from 'vitest';

import { inspectAuditRetention } from '@/cli/commands/doctor-command.js';

/**
 * With retention enforcement shipped (ADR-68), the three strategies each have a
 * real behavior and none is a silent no-op: `full` keeps everything (reported
 * silently), `recent` archives old segments (kept verifiable), and `local`
 * prunes via the opt-in `mnema audit prune`. doctor reports recent/local as
 * informational ok lines — no longer "reserved but inert" warnings.
 */
describe('inspectAuditRetention', () => {
  it('passes full silently (keep-everything matches actual behavior)', () => {
    expect(inspectAuditRetention('full', 12)).toEqual([]);
  });

  it('reports recent as an ok line: archives old months, keeps them verifiable', () => {
    const [check] = inspectAuditRetention('recent', 12);
    expect(check?.name).toBe('audit retention');
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('recent');
    expect(check?.detail).toContain('12 months');
    expect(check?.detail).toMatch(/archiv/i);
    // No longer calls it a no-op / not-yet-enforced.
    expect(check?.detail).not.toMatch(/not yet enforced|no-op/i);
  });

  it('reports local as an ok line that points at the prune command', () => {
    const [check] = inspectAuditRetention('local', 6);
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('6 months');
    expect(check?.detail).toContain('mnema audit prune');
    expect(check?.detail).toMatch(/opt-in|never runs automatically/i);
  });

  it('never raises the doctor exit code (ok lines, no error severity)', () => {
    for (const strategy of ['recent', 'local'] as const) {
      const [check] = inspectAuditRetention(strategy, 12);
      const countsAsError =
        check !== undefined && !check.ok && (check.severity ?? 'error') === 'error';
      expect(countsAsError).toBe(false);
    }
  });
});
