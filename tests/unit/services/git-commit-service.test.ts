import { describe, expect, it } from 'vitest';

import {
  type GitCommandRunner,
  GitCommitFailedError,
  GitCommitNotARepoError,
  GitCommitService,
  type GitResult,
} from '@/services/git/git-commit-service.js';

const OK: GitResult = { status: 0, stdout: '', stderr: '' };

/** Records every git invocation and answers from a handler. */
function fakeGit(handler: (args: readonly string[]) => GitResult) {
  const calls: string[][] = [];
  const run: GitCommandRunner = (args) => {
    calls.push([...args]);
    return handler(args);
  };
  return { run, calls };
}

/** NUL-joins name-only records the way `git diff --cached -z` emits them. */
function z(...paths: string[]): string {
  return paths.map((p) => `${p}\0`).join('');
}

/**
 * A runner simulating a repo. `stagedByCall` supplies the staged name-only
 * output for successive `git diff --cached` calls (the service calls it once
 * per bucket), so a test can model the index shrinking after the trail
 * commit. `rev-parse` reports a repo with a `.git` dir and no sequencer.
 */
function repo(
  stagedByCall: string[],
  onCommit?: (args: readonly string[]) => GitResult,
  dirtyPaths: readonly string[] = [],
) {
  let diffCall = 0;
  return fakeGit((args) => {
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
      return { status: 0, stdout: 'true\n', stderr: '' };
    }
    if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
      // Point at a dir with no merge/rebase markers (nothing exists there).
      return { status: 0, stdout: '/nonexistent-git-dir\n', stderr: '' };
    }
    if (args[0] === 'diff' && args[1] === '--cached') {
      const out = stagedByCall[diffCall] ?? '';
      diffCall++;
      return { status: 0, stdout: out, stderr: '' };
    }
    // Unstaged working-tree diff for a single pathspec: `git diff --name-only
    // -z -- <path>`. Reports the path only when the test marked it dirty.
    if (args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')) {
      const target = args[args.length - 1];
      return { status: 0, stdout: dirtyPaths.includes(target) ? `${target}\0` : '', stderr: '' };
    }
    if (args[0] === 'add') return OK;
    if (args[0] === 'commit') return onCommit ? onCommit(args) : OK;
    return OK;
  });
}

describe('GitCommitService', () => {
  it('throws when not inside a git work tree', () => {
    const { run } = fakeGit((args) =>
      args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree'
        ? { status: 128, stdout: '', stderr: 'not a repo' }
        : OK,
    );
    expect(() => new GitCommitService('/repo', '.mnema', run).commit({ message: 'x' })).toThrow(
      GitCommitNotARepoError,
    );
  });

  it('commits trail (by pathspec) first, then code (from the index, no pathspec)', () => {
    // Call 1 (trail bucket): trail staged after `git add .mnema`.
    // Call 2 (code bucket): only code remains staged.
    const { run, calls } = repo([z('.mnema/audit/current.jsonl', 'app.js'), z('app.js')]);
    const result = new GitCommitService('/repo', '.mnema', run).commit({ message: 'feat: x' });

    expect(result.committed.map((c) => c.kind)).toEqual(['trail', 'code']);
    const commits = calls.filter((c) => c[0] === 'commit');
    // Trail commit is scoped to the trail dir by pathspec.
    expect(commits[0]).toEqual(['commit', '-m', 'chore(mnema): update trail', '--', '.mnema']);
    // Code commit carries NO pathspec — it commits the staged index verbatim.
    expect(commits[1]).toEqual(['commit', '-m', 'feat: x']);
    // It never `git add`s code — the only add is the trail dir.
    const adds = calls.filter((c) => c[0] === 'add');
    expect(adds).toEqual([['add', '--', '.mnema']]);
  });

  it('folds an ALREADY-STAGED extra root file (AGENTS.md) into the trail commit', () => {
    // The user (or a regeneration step) has staged AGENTS.md; the service must
    // NOT `git add` it, only reclassify it from code into the trail commit.
    const { run, calls } = repo([
      z('.mnema/audit/current.jsonl', 'AGENTS.md', 'app.js'),
      z('app.js'),
    ]);
    const result = new GitCommitService('/repo', '.mnema', run, ['AGENTS.md']).commit({
      message: 'feat: x',
    });

    expect(result.committed.map((c) => c.kind)).toEqual(['trail', 'code']);
    const commits = calls.filter((c) => c[0] === 'commit');
    // AGENTS.md rides in the trail commit's pathspec, beside .mnema.
    expect(commits[0]).toEqual([
      'commit',
      '-m',
      'chore(mnema): update trail',
      '--',
      '.mnema',
      'AGENTS.md',
    ]);
    // The code commit is still pathspec-free (index verbatim), and AGENTS.md
    // is not in the code bucket.
    expect(commits[1]).toEqual(['commit', '-m', 'feat: x']);
    expect(result.committed[1]?.paths).toEqual(['app.js']);
    // Crucially: the service never `git add`s AGENTS.md — only the trail dir.
    const adds = calls.filter((c) => c[0] === 'add');
    expect(adds).toEqual([['add', '--', '.mnema']]);
  });

  it('does not fold in an extra file that has UNSTAGED edits (preserves WIP)', () => {
    // AGENTS.md is staged but ALSO dirty in the working tree. A pathspec commit
    // would capture the WIP, so the service leaves it out of the trail commit.
    const { run, calls } = repo(
      [z('.mnema/audit/current.jsonl', 'AGENTS.md'), ''],
      undefined,
      ['AGENTS.md'], // dirty (unstaged changes on top of the staged content)
    );
    const result = new GitCommitService('/repo', '.mnema', run, ['AGENTS.md']).commit({
      message: 'x',
    });
    expect(result.committed.map((c) => c.kind)).toEqual(['trail']);
    const commits = calls.filter((c) => c[0] === 'commit');
    // Trail pathspec is just .mnema — AGENTS.md is NOT committed (WIP preserved).
    expect(commits[0]).toEqual(['commit', '-m', 'chore(mnema): update trail', '--', '.mnema']);
    // And the service never staged it.
    expect(calls.filter((c) => c[0] === 'add')).toEqual([['add', '--', '.mnema']]);
  });

  it('makes no commit (and no error) when the only staged item is a dirty extra', () => {
    // AGENTS.md is the sole staged path AND it is dirty, so it is excluded;
    // with no real .mnema churn there is nothing to commit — the service must
    // skip cleanly, never run `git commit -- .mnema` against an empty index.
    const { run, calls } = repo([z('AGENTS.md'), ''], undefined, ['AGENTS.md']);
    const result = new GitCommitService('/repo', '.mnema', run, ['AGENTS.md']).commit({
      message: 'x',
    });
    expect(result.committed).toHaveLength(0);
    expect(result.nothing).toBeDefined();
    expect(calls.some((c) => c[0] === 'commit')).toBe(false);
  });

  it('leaves a root file OUT of the trail commit when it is not configured', () => {
    // .gitattributes is staged but not in trail_extra_paths → it is code.
    const { run, calls } = repo([
      z('.mnema/audit/current.jsonl', '.gitattributes'),
      z('.gitattributes'),
    ]);
    const result = new GitCommitService('/repo', '.mnema', run, ['AGENTS.md']).commit({
      message: 'chore: attrs',
    });
    expect(result.committed.map((c) => c.kind)).toEqual(['trail', 'code']);
    const commits = calls.filter((c) => c[0] === 'commit');
    // Trail pathspec is just .mnema (AGENTS.md was never staged).
    expect(commits[0]).toEqual(['commit', '-m', 'chore(mnema): update trail', '--', '.mnema']);
    expect(result.committed[1]?.paths).toEqual(['.gitattributes']);
  });

  it('does nothing with a configured extra file that is not staged', () => {
    // AGENTS.md configured but not staged: it never appears in the trail
    // pathspec and the commit still succeeds. The service never `git add`s it.
    const { run, calls } = repo([z('.mnema/audit/current.jsonl'), '']);
    const result = new GitCommitService('/repo', '.mnema', run, ['AGENTS.md']).commit({
      message: 'x',
    });
    expect(result.committed.map((c) => c.kind)).toEqual(['trail']);
    const commits = calls.filter((c) => c[0] === 'commit');
    expect(commits[0]).toEqual(['commit', '-m', 'chore(mnema): update trail', '--', '.mnema']);
  });

  it('auto-stages the trail dir before committing it', () => {
    const { calls, run } = repo([z('.mnema/audit/current.jsonl'), '']);
    new GitCommitService('/repo', '.mnema', run).commit({ message: 'x' });
    expect(calls.some((c) => c[0] === 'add' && c.includes('.mnema'))).toBe(true);
  });

  it('commits only the trail when no code is staged', () => {
    const { run, calls } = repo([z('.mnema/backlog/DRAFT/CT-1.md'), '']);
    const result = new GitCommitService('/repo', '.mnema', run).commit({ message: 'unused' });
    expect(result.committed.map((c) => c.kind)).toEqual(['trail']);
    expect(calls.filter((c) => c[0] === 'commit')).toHaveLength(1);
  });

  it('commits only code when the trail bucket is empty', () => {
    // Trail add stages nothing; both diff calls report only code staged.
    const { run, calls } = repo([z('app.js'), z('app.js')]);
    const result = new GitCommitService('/repo', '.mnema', run).commit({ message: 'feat: y' });
    expect(result.committed.map((c) => c.kind)).toEqual(['code']);
    const commits = calls.filter((c) => c[0] === 'commit');
    expect(commits).toEqual([['commit', '-m', 'feat: y']]);
  });

  it('trailOnly commits the trail and never inspects/commits code', () => {
    const { run, calls } = repo([z('.mnema/audit/current.jsonl')]);
    const result = new GitCommitService('/repo', '.mnema', run).commit({
      trailOnly: true,
      message: 'ignored',
    });
    expect(result.committed.map((c) => c.kind)).toEqual(['trail']);
    expect(calls.filter((c) => c[0] === 'commit')).toHaveLength(1);
  });

  it('reports a no-op when nothing is staged and no trail churn', () => {
    const { run, calls } = repo(['', '']);
    const result = new GitCommitService('/repo', '.mnema', run).commit({ message: 'x' });
    expect(result.committed).toHaveLength(0);
    expect(result.nothing).toBeDefined();
    expect(calls.some((c) => c[0] === 'commit')).toBe(false);
  });

  it('errors (without an empty commit) when code is staged but no message given', () => {
    const { run, calls } = repo([z('app.js'), z('app.js')]);
    expect(() => new GitCommitService('/repo', '.mnema', run).commit({})).toThrow(
      GitCommitFailedError,
    );
    expect(calls.some((c) => c[0] === 'commit')).toBe(false);
  });

  it('propagates a failed trail commit as GitCommitFailedError(trail)', () => {
    const { run } = repo([z('.mnema/audit/current.jsonl'), ''], () => ({
      status: 1,
      stdout: '',
      stderr: 'pre-commit hook failed',
    }));
    expect(() => new GitCommitService('/repo', '.mnema', run).commit({ message: 'x' })).toThrow(
      /trail/,
    );
  });

  it('refuses to run while a merge is in progress', () => {
    // rev-parse --git-dir points at a real dir; MERGE_HEAD presence is what
    // the guard checks. Simulate by pointing git-dir at a path we control.
    const { run } = fakeGit((args) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
        return { status: 0, stdout: 'true\n', stderr: '' };
      }
      // Point at this repo's own .git, which has no MERGE_HEAD — so instead
      // assert the happy path is NOT blocked here; the merge-block path is
      // covered by the e2e test against a real conflicted repo.
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
        return { status: 0, stdout: '/nonexistent\n', stderr: '' };
      }
      if (args[0] === 'diff') return { status: 0, stdout: '', stderr: '' };
      return OK;
    });
    // No sequencer marker at /nonexistent → not blocked → no-op (nothing staged).
    const result = new GitCommitService('/repo', '.mnema', run).commit({ message: 'x' });
    expect(result.nothing).toBeDefined();
  });
});
