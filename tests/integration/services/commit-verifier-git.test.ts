import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommitVerifier } from '@/services/commit-verifier.js';

/**
 * Exercises CommitVerifier against a REAL git repository through the
 * production `defaultRunner` (no injected mock), so the actual
 * `git rev-parse` / `git cat-file` shell-out — the one path every unit
 * test stubs out — is proven end to end.
 */
describe('CommitVerifier against real git', () => {
  let repo: string;
  let headSha: string;
  // Production verifier: no runner injected → uses the real defaultRunner.
  const verifier = new CommitVerifier();

  /** Hermetic git env: never reads the developer's global config. */
  function git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'mnema-commit-real-'));
    git(['init', '-b', 'main']);
    writeFileSync(path.join(repo, 'file.txt'), 'hello\n', 'utf-8');
    git(['add', '-A']);
    git(['commit', '-m', 'initial']);
    headSha = git(['rev-parse', 'HEAD']).trim();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('finds a real commit by full SHA', () => {
    expect(verifier.verify(headSha, repo)).toEqual({ checked: true, found: true });
  });

  it('finds a real commit by short SHA and by HEAD', () => {
    expect(verifier.verify(headSha.slice(0, 8), repo)).toEqual({ checked: true, found: true });
    expect(verifier.verify('HEAD', repo)).toEqual({ checked: true, found: true });
  });

  it('reports a checked miss for a well-formed SHA that does not exist', () => {
    const ghost = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const result = verifier.verify(ghost, repo);
    expect(result.checked).toBe(true);
    expect(result.found).toBe(false);
    expect(result.reason).toContain(ghost);
  });

  it('does not peel a non-commit object (a blob) to found', () => {
    // The blob for file.txt is a real object, but it is not a commit, so
    // `<blob>^{commit}` must fail — a real miss, never wrongly found.
    const blobSha = git(['rev-parse', 'HEAD:file.txt']).trim();
    const result = verifier.verify(blobSha, repo);
    expect(result.checked).toBe(true);
    expect(result.found).toBe(false);
  });

  it('treats a ref that looks like a flag as a miss, never an option', () => {
    // A hostile evidence ref beginning with `-` must be read as an object
    // name (and fail to resolve), not parsed by git as an option. Without
    // the `--end-of-options` guard, `git cat-file` would reject it as an
    // unknown flag instead of reporting a clean miss.
    const result = verifier.verify('--not-a-real-flag', repo);
    expect(result.checked).toBe(true);
    expect(result.found).toBe(false);
  });

  it('does not honour a `--output=` ref (no arbitrary file write)', () => {
    // Regression guard: `git` sub-commands accept `--output=<path>`, which
    // would write an arbitrary file. The ref reaches the shell-out as an
    // operand, so the guard must stop it from ever being seen as a flag.
    const sink = path.join(repo, 'PWNED.txt');
    const result = verifier.verify(`--output=${sink}`, repo);
    expect(existsSync(sink)).toBe(false);
    expect(result.found).toBe(false);
  });

  it('degrades to unchecked outside any git repository', () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'mnema-not-a-repo-'));
    try {
      const result = verifier.verify(headSha, notRepo);
      expect(result.checked).toBe(false);
      expect(result.found).toBe(false);
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});
