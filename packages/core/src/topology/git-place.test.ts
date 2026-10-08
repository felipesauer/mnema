import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitPlaceOf, isWithin, privateTreePlace } from './git-place.js';

let sandbox: string;

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'mnema-git-place-')));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A git directory as git lays one out, as far as this reads it: a `HEAD`. */
function aGitDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

describe('gitPlaceOf — read from the files git writes, without running git', () => {
  it('takes a .git directory for its own common directory', () => {
    aGitDir(join(sandbox, 'repo', '.git'));
    mkdirSync(join(sandbox, 'repo', 'a', 'b'), { recursive: true });
    expect(gitPlaceOf(join(sandbox, 'repo', 'a', 'b'))).toEqual({
      top: join(sandbox, 'repo'),
      gitDir: join(sandbox, 'repo', '.git'),
      commonDir: join(sandbox, 'repo', '.git'),
    });
  });

  it('follows a .git file, relative or absolute, and the commondir a linked worktree names', () => {
    const common = aGitDir(join(sandbox, 'repo', '.git'));
    const own = aGitDir(join(common, 'worktrees', 'wt'));
    writeFileSync(join(own, 'commondir'), '../..\n');
    mkdirSync(join(sandbox, 'wt'));
    writeFileSync(join(sandbox, 'wt', '.git'), 'gitdir: ../repo/.git/worktrees/wt\n');
    expect(gitPlaceOf(join(sandbox, 'wt'))).toEqual({
      top: join(sandbox, 'wt'),
      gitDir: own,
      commonDir: common,
    });
  });

  it('answers nothing outside a repository, or where .git names nothing git would take', () => {
    expect(gitPlaceOf(sandbox)).toBeUndefined();
    writeFileSync(join(sandbox, '.git'), 'gitdir: ./nowhere\n');
    expect(gitPlaceOf(sandbox)).toBeUndefined();
  });
});

describe('privateTreePlace', () => {
  it('keys the tree by the project’s path under the top, in the common directory, and the id in the worktree’s own', () => {
    const common = aGitDir(join(sandbox, 'repo', '.git'));
    const own = aGitDir(join(common, 'worktrees', 'wt'));
    writeFileSync(join(own, 'commondir'), '../..\n');
    mkdirSync(join(sandbox, 'wt', 'sub'), { recursive: true });
    writeFileSync(join(sandbox, 'wt', '.git'), `gitdir: ${own}\n`);
    expect(privateTreePlace(join(sandbox, 'wt', 'sub'))).toEqual({
      tree: join(common, 'mnema', 'sub', 'private'),
      installation: join(own, 'mnema', 'sub', 'private'),
    });
  });
});

describe('isWithin', () => {
  it('is true for the directory and what is under it, and false for a sibling that shares a prefix', () => {
    expect(isWithin('/r/.git', '/r/.git')).toBe(true);
    expect(isWithin('/r/.git/mnema/private', '/r/.git')).toBe(true);
    expect(isWithin('/r/.github/mnema', '/r/.git')).toBe(false);
    expect(isWithin('/r/.mnema/private', '/r/.git')).toBe(false);
  });
});
