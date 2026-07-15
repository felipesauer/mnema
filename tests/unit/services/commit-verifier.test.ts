import { describe, expect, it } from 'vitest';
import type { CommandResult, CommandRunner } from '@/services/git/github-pr-service.js';
import { CommitVerifier } from '@/services/integrity/commit-verifier.js';

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

  it('distinguishes a missing SHA from a ref that is not a commit at all', () => {
    const v = new CommitVerifier(runner({ inRepo: true, catFileStatus: 1 }));

    // A SHA-shaped ref that git cannot resolve is a genuine miss.
    const missingSha = v.verify('deadbeef', ROOT);
    expect(missingSha.found).toBe(false);
    expect(missingSha.reason).toContain('not found in this repository');
    expect(missingSha.reason).not.toContain('not a commit');

    // A file path is not a commit-ish — the advisory must say so, and it
    // must differ from the missing-SHA message.
    const filePath = v.verify('src/foo.ts', ROOT);
    expect(filePath.checked).toBe(true); // still non-blocking, still checked
    expect(filePath.found).toBe(false);
    expect(filePath.reason).toContain('is not a commit');
    expect(filePath.reason).not.toBe(missingSha.reason);
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
