import { describe, expect, it } from 'vitest';

import { inspectAuditRetention } from '@/cli/commands/doctor-command.js';

/**
 * `audit_strategy` / `audit_retention_months` are accepted and validated but
 * not yet enforced — the audit chain is append-only, so nothing is pruned.
 * doctor must surface an inert-but-expectant setting (recent/local, or any
 * finite retention) as a warning so it isn't mistaken for active retention,
 * while `full` (keep everything = today's real behavior) passes silently.
 */
describe('inspectAuditRetention', () => {
  it('passes full silently (keep-everything matches actual behavior)', () => {
    expect(inspectAuditRetention('full', 12)).toEqual([]);
  });

  it('flags recent as a not-ok warning that names the no-op and the escape hatch', () => {
    const [check] = inspectAuditRetention('recent', 12);
    expect(check?.name).toBe('audit retention');
    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    expect(check?.detail).toContain('recent');
    expect(check?.detail).toContain('not yet enforced');
    expect(check?.detail).toContain('full'); // points at the behavior-matching value
  });

  it('flags local as a not-ok warning too', () => {
    const [check] = inspectAuditRetention('local', 6);
    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    // The configured retention window is echoed so the warning is concrete.
    expect(check?.detail).toContain('6 months');
  });

  it('keeps the warning from raising the exit code (severity warning, not error)', () => {
    // doctor derives its exit code from `!ok && (severity ?? 'error') === 'error'`.
    const [check] = inspectAuditRetention('recent', 12);
    const countsAsError =
      check !== undefined && !check.ok && (check.severity ?? 'error') === 'error';
    expect(countsAsError).toBe(false);
  });
});
