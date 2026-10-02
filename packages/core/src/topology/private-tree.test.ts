import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodedError } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrivateTreeVisibleError, privateTreeVisibility } from './private-tree.js';
import type { ResolvedTrees } from './resolve.js';

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
