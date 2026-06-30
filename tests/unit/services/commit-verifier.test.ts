import { describe, expect, it } from 'vitest';

import { CommitVerifier } from '@/services/commit-verifier.js';
import type { CommandResult, CommandRunner } from '@/services/github-pr-service.js';

const ROOT = '/repo';

/**
 * Builds a runner that answers the two probes CommitVerifier makes:
 * `rev-parse --is-inside-work-tree` and `cat-file -e <ref>^{commit}`.
 * `inRepo` controls the first; `catFileStatus` the second.
 */
function runner(opts: { inRepo?: boolean | CommandResult; catFileStatus?: number }): CommandRunner {
  return (_command, args) => {
    if (args.includes('rev-parse')) {
      if (typeof opts.inRepo === 'object') return opts.inRepo;
      return opts.inRepo === false ? { status: 128, stdout: '' } : { status: 0, stdout: 'true\n' };
    }
    // cat-file -e
    return { status: opts.catFileStatus ?? 0, stdout: '' };
  };
}

describe('CommitVerifier', () => {
  it('reports found when the ref resolves to a commit', () => {
    const v = new CommitVerifier(runner({ inRepo: true, catFileStatus: 0 }));
    const result = v.verify('abc1234', ROOT);
    expect(result).toEqual({ checked: true, found: true });
  });

  it('reports not-found (checked) when the ref does not resolve', () => {
    const v = new CommitVerifier(runner({ inRepo: true, catFileStatus: 1 }));
    const result = v.verify('deadbeef', ROOT);
    expect(result.checked).toBe(true);
    expect(result.found).toBe(false);
    expect(result.reason).toContain('deadbeef');
  });

  it('degrades to unchecked outside a git repository', () => {
    const v = new CommitVerifier(runner({ inRepo: false }));
    const result = v.verify('abc1234', ROOT);
    expect(result.checked).toBe(false);
    expect(result.found).toBe(false);
  });

  it('degrades to unchecked when git is not on PATH', () => {
    // A missing binary surfaces as an Error from spawnSync; the runner
    // mirrors that on the first probe.
    const v = new CommitVerifier(
      runner({ inRepo: { status: null, stdout: '', error: new Error('ENOENT') } }),
    );
    const result = v.verify('abc1234', ROOT);
    expect(result.checked).toBe(false);
    expect(result.reason).toBe('git not available');
  });

  it('does not check an empty ref', () => {
    let called = false;
    const v = new CommitVerifier(() => {
      called = true;
      return { status: 0, stdout: '' };
    });
    const result = v.verify('   ', ROOT);
    expect(result.checked).toBe(false);
    expect(called).toBe(false); // never even shells out
  });
});
