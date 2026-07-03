import { describe, expect, it } from 'vitest';

import { inspectIdentity } from '@/cli/commands/doctor-command.js';

/**
 * doctor used to say nothing about identity, so a fresh machine passed
 * green yet crashed on the first mutation. A missing actor is now a
 * warning (project is otherwise healthy; the user just has to set it);
 * a resolved actor passes and names its source.
 */
describe('inspectIdentity', () => {
  it('flags a missing actor as a not-ok warning with an actionable hint', () => {
    const [check] = inspectIdentity({ actor: null, source: 'none' });
    expect(check?.name).toBe('identity configured');
    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    expect(check?.detail).toContain('mnema identity set');
  });

  it('passes and names the source when the actor comes from the env', () => {
    const [check] = inspectIdentity({ actor: 'alice', source: 'env' });
    expect(check?.ok).toBe(true);
    expect(check?.detail).toBe('alice (env)');
  });

  it('passes and names the source when the actor comes from config', () => {
    const [check] = inspectIdentity({ actor: 'bob', source: 'config' });
    expect(check?.ok).toBe(true);
    expect(check?.detail).toBe('bob (config)');
  });

  it('keeps the missing-identity warning from raising the exit code', () => {
    // doctor errors only on `!ok && (severity ?? 'error') === 'error'`.
    const [check] = inspectIdentity({ actor: null, source: 'none' });
    const countsAsError =
      check !== undefined && !check.ok && (check.severity ?? 'error') === 'error';
    expect(countsAsError).toBe(false);
  });
});
