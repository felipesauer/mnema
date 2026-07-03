import { describe, expect, it } from 'vitest';

import { inspectEnforcementMode } from '@/cli/commands/doctor-command.js';

/**
 * `enforcement_mode` defaults to `strict`, but a cloned repo can ship
 * `advisory` and silently disable gate enforcement for everyone. doctor
 * used to hardcode this check as ok; a weakened mode must now be flagged
 * as a warning (visible, but not a hard failure so the exit stays 0).
 */
describe('inspectEnforcementMode', () => {
  it('flags advisory as a not-ok warning', () => {
    const [check] = inspectEnforcementMode('advisory');
    expect(check?.name).toBe('enforcement mode');
    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    // The message names the effect and how to restore protection.
    expect(check?.detail).toContain('enforcement is off');
    expect(check?.detail).toContain('strict');
  });

  it('passes strict (the safe default)', () => {
    const [check] = inspectEnforcementMode('strict');
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('strict');
  });

  it('passes blocking (stricter than the default)', () => {
    const [check] = inspectEnforcementMode('blocking');
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('blocks everyone');
  });

  it('keeps the advisory warning from raising the exit code (severity warning, not error)', () => {
    // doctor derives its exit code from `!ok && (severity ?? 'error') === 'error'`.
    // An advisory warning is ok:false but severity 'warning', so it must not count.
    const [check] = inspectEnforcementMode('advisory');
    const countsAsError =
      check !== undefined && !check.ok && (check.severity ?? 'error') === 'error';
    expect(countsAsError).toBe(false);
  });
});
