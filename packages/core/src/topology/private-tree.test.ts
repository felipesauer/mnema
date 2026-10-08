import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodedError } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrivateTreeVisibleError, privateTreeVisibility } from './private-tree.js';
import { type ResolvedTrees, resolveTrees } from './resolve.js';

let repo: string;
let trees: ResolvedTrees;
const pathBefore = process.env.PATH;

/** git with nothing of the machine's configuration in it, so the answer is the repo's own. */
function git(...args: string[]): void {
  const ran = spawnSync('git', args, {
    cwd: repo,
    env: {
      PATH: pathBefore ?? '',
      HOME: repo,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  });
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mnema-private-tree-'));
  mkdirSync(join(repo, '.mnema'));
  trees = {
    projectPublic: join(repo, '.mnema'),
    projectPrivate: join(repo, '.mnema', 'private'),
    global: join(repo, 'global'),
    keyRoot: join(repo, 'identity'),
  };
});

afterEach(() => {
  process.env.PATH = pathBefore;
  rmSync(repo, { recursive: true, force: true });
});

describe('whether git would stage the private tree', () => {
  it('says ignored where the committed file lists it', () => {
    git('init', '-q');
    writeFileSync(join(repo, '.mnema', '.gitignore'), '/private/\n');
    expect(privateTreeVisibility(trees)).toEqual({ state: 'ignored' });
  });

  it('says visible, and where the way out is, where nothing ignores it', () => {
    git('init', '-q');
    writeFileSync(join(repo, '.mnema', '.gitignore'), '/locks/\n');
    expect(privateTreeVisibility(trees)).toEqual({
      state: 'visible',
      path: '.mnema/private',
      gitignore: '.mnema/.gitignore',
    });
  });

  it('asks about a path under the tree, so a tree not yet written is answered like one that is', () => {
    git('init', '-q');
    writeFileSync(join(repo, '.mnema', '.gitignore'), '/private/\n');
    mkdirSync(join(repo, '.mnema', 'private'));
    expect(privateTreeVisibility(trees)).toEqual({ state: 'ignored' });
  });

  it('says unknown outside a repository, where there is no commit to leak into', () => {
    expect(privateTreeVisibility(trees)).toEqual({ state: 'unknown' });
  });

  it('says unknown with no git to ask, rather than guessing', () => {
    git('init', '-q');
    process.env.PATH = join(repo, 'no-such-directory');
    expect(privateTreeVisibility(trees)).toEqual({ state: 'unknown' });
  });

  it('says outside the worktree for a tree in the repository’s git directory, whatever the .gitignore says', () => {
    // Where discovery puts it inside a repository: no `git add` stages a path under `.git/`,
    // so there is nothing to ask git, and nothing to refuse — even with no `/private/` line.
    git('init', '-q');
    writeFileSync(join(repo, '.mnema', '.gitignore'), '/locks/\n');
    const inRepository = { ...trees, projectPrivate: join(repo, '.git', 'mnema', 'private') };
    expect(privateTreeVisibility(inRepository)).toEqual({ state: 'outside-the-worktree' });
  });

  it('still says visible for a private tree inside the worktree that nothing ignores, in a repository whose git directory exists', () => {
    // The neighbour of the case above: a guard that answered "outside" for every tree in a
    // repository would pass that one and stage this one.
    git('init', '-q');
    writeFileSync(join(repo, '.mnema', '.gitignore'), '/locks/\n');
    expect(privateTreeVisibility(trees).state).toBe('visible');
  });

  it('still says visible where the git directory a .git file names lies INSIDE the worktree', () => {
    // `gitdir: realgd`, with `realgd` in the working tree: the private tree discovery puts under
    // the git directory is then a path `git add -A` stages. Being under the git directory is not
    // being out of the worktree.
    git('init', '-q', '--separate-git-dir', join(repo, 'realgd'));
    writeFileSync(join(repo, '.mnema', '.gitignore'), '/private/\n');
    const resolved = resolveTrees(repo, { home: join(repo, 'home') });
    expect(resolved.projectPrivate?.startsWith(join(repo, 'realgd'))).toBe(true);
    expect(privateTreeVisibility(resolved).state).toBe('visible');
  });

  it('still says visible where a commondir reached through a symbolic link leads back into the worktree', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mnema-private-tree-outside-'));
    try {
      // A real repository moved inside the worktree, named as the common directory of a linked
      // worktree's git directory that lives outside it, through a link that also lives outside.
      git('init', '-q');
      renameSync(join(repo, '.git'), join(repo, 'hidden'));
      symlinkSync(join(repo, 'hidden'), join(outside, 'link'));
      mkdirSync(join(outside, 'own'));
      writeFileSync(join(outside, 'own', 'HEAD'), 'ref: refs/heads/main\n');
      writeFileSync(join(outside, 'own', 'commondir'), `${join(outside, 'link')}\n`);
      writeFileSync(join(outside, 'own', 'gitdir'), `${join(repo, '.git')}\n`);
      writeFileSync(join(repo, '.git'), `gitdir: ${join(outside, 'own')}\n`);
      writeFileSync(join(repo, '.mnema', '.gitignore'), '/private/\n');
      const resolved = resolveTrees(repo, { home: join(repo, 'home') });
      expect(resolved.projectPrivate?.startsWith(join(outside, 'link'))).toBe(true);
      expect(privateTreeVisibility(resolved).state).not.toBe('outside-the-worktree');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('says unknown outside a project, which has no private tree', () => {
    expect(privateTreeVisibility({ global: trees.global, keyRoot: trees.keyRoot })).toEqual({
      state: 'unknown',
    });
  });
});

describe('the refusal', () => {
  it('is a coded refusal that names the file, the rule that belongs in it, and that nothing was written', () => {
    const refusal = new PrivateTreeVisibleError({
      state: 'visible',
      path: '.mnema/private',
      gitignore: '.mnema/.gitignore',
    });
    expect(refusal).toBeInstanceOf(CodedError);
    expect(refusal.code).toBe('PRIVATE_TREE_VISIBLE');
    expect(refusal.message).toContain('.mnema/.gitignore');
    expect(refusal.message).toContain('`/private/`');
    expect(refusal.message).toContain('Nothing was written.');
  });
});
