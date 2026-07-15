import { describe, expect, it } from 'vitest';

import { inspectTrackedIgnored, listTrackedFiles } from '@/cli/commands/doctor-command.js';
import type { GitCommandRunner } from '@/services/git-commit-service.js';

/**
 * `mnema upgrade` reconciles the managed `.gitignore` block but deliberately
 * never untracks a file a repo committed before the rule existed — that
 * rewrites history. doctor instead WARNS, naming the file(s) and the exact
 * `git rm --cached` the user can run. The warning keeps exit 0 (severity
 * 'warning') and doctor never touches history itself.
 */
describe('inspectTrackedIgnored', () => {
  const statePath = '.mnema/state';
  const auditPath = '.mnema/audit';

  it('warns and prints `git rm --cached` when a tracked file matches the managed block', () => {
    const tracked = [
      'src/index.ts',
      '.mnema/audit/.audit.lock', // committed before the ignore rule existed
      '.mnema/audit/current.jsonl', // the committed audit log — must NOT be flagged
    ];
    const [check] = inspectTrackedIgnored(tracked, statePath, auditPath);
    expect(check?.name).toBe('tracked files now ignored');
    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('warning');
    expect(check?.detail).toContain('git rm --cached .mnema/audit/.audit.lock');
    // The committed audit log and unrelated source stay untouched.
    expect(check?.detail).not.toContain('current.jsonl');
    expect(check?.detail).not.toContain('src/index.ts');
  });

  it('passes (no warning) when nothing tracked is now ignored', () => {
    const tracked = ['src/index.ts', '.mnema/audit/current.jsonl', '.mnema/backlog/TODO/KEY-1.md'];
    const [check] = inspectTrackedIgnored(tracked, statePath, auditPath);
    expect(check?.name).toBe('no tracked ignored files');
    expect(check?.ok).toBe(true);
  });

  it('keeps the warning from raising the exit code (severity warning, not error)', () => {
    // doctor derives its exit from `!ok && (severity ?? 'error') === 'error'`.
    const [check] = inspectTrackedIgnored(['.mnema/audit/.audit.lock'], statePath, auditPath);
    const countsAsError =
      check !== undefined && !check.ok && (check.severity ?? 'error') === 'error';
    expect(countsAsError).toBe(false);
  });
});

describe('listTrackedFiles', () => {
  it('is a silent no-op (empty list) outside a git repo — never throws', () => {
    const notARepo: GitCommandRunner = () => ({
      status: 128,
      stdout: '',
      stderr: 'not a git repo',
    });
    expect(listTrackedFiles('/whatever', notARepo)).toEqual([]);
  });

  it('splits the NUL-delimited `git ls-files -z` output', () => {
    const runner: GitCommandRunner = (args) => {
      expect(args).toEqual(['ls-files', '-z']);
      return { status: 0, stdout: 'a.ts\0.mnema/audit/.audit.lock\0', stderr: '' };
    };
    expect(listTrackedFiles('/repo', runner)).toEqual(['a.ts', '.mnema/audit/.audit.lock']);
  });
});
