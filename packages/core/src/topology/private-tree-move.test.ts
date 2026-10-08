import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LeftBehind, movePrivateTree, privateTreesLeftBehind } from './private-tree-move.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-private-move-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A repository with a linked worktree, as git lays them out, and a project at the top of each. */
function aRepositoryWithAWorktree(): { repo: string; wt: string; common: string; own: string } {
  const repo = join(sandbox, 'repo');
  const wt = join(sandbox, 'wt');
  const common = join(repo, '.git');
  const own = join(common, 'worktrees', 'wt');
  put(join(common, 'HEAD'), 'ref: refs/heads/main\n');
  put(join(own, 'HEAD'), 'ref: refs/heads/wt\n');
  put(join(own, 'commondir'), '../..\n');
  put(join(own, 'gitdir'), `${join(wt, '.git')}\n`);
  put(join(wt, '.git'), `gitdir: ${own}\n`);
  mkdirSync(join(repo, '.mnema'));
  mkdirSync(join(wt, '.mnema'));
  return { repo, wt, common, own };
}

describe('privateTreesLeftBehind', () => {
  it('finds the old tree of every worktree, from either of them', () => {
    const { repo, wt, common, own } = aRepositoryWithAWorktree();
    put(join(repo, '.mnema', 'private', 'tails', 'fp-a', 'x'), 'a');
    put(join(wt, '.mnema', 'private', 'tails', 'fp-b', 'x'), 'b');
    for (const from of [repo, wt]) {
      const found = privateTreesLeftBehind(from);
      expect(found?.to).toBe(join(common, 'mnema', '%2E', 'private'));
      expect([...(found?.left ?? [])].sort((x, y) => x.worktree.localeCompare(y.worktree))).toEqual(
        [
          {
            worktree: repo,
            tree: join(repo, '.mnema', 'private'),
            tails: 1,
            installation: join(common, 'mnema', '%2E', 'private'),
          },
          {
            worktree: wt,
            tree: join(wt, '.mnema', 'private'),
            tails: 1,
            installation: join(own, 'mnema', '%2E', 'private'),
          },
        ],
      );
    }
  });

  it('answers nothing outside a repository, where the tree has not moved', () => {
    mkdirSync(join(sandbox, '.mnema', 'private'), { recursive: true });
    expect(privateTreesLeftBehind(sandbox)).toBeUndefined();
  });
});

describe('movePrivateTree', () => {
  function left(tree: string, installation: string): LeftBehind {
    return { worktree: dirname(dirname(tree)), tree, tails: 0, installation };
  }

  it('moves tails and key files, carries the installation id, and discards locks', () => {
    const from = join(sandbox, 'old');
    const to = join(sandbox, 'shared');
    const own = join(sandbox, 'own');
    put(join(from, 'tails', 'fp-1', 'seg'), 'events');
    put(join(from, 'keys', 'fp.pub'), 'pub');
    put(join(from, 'keys', 'fp.anchor'), 'anchor');
    put(join(from, 'keys', 'fp.inst'), '1\n');
    put(join(from, 'locks', 'projection.db'), 'cache');
    // Already in the shared tree, from another worktree of the same machine: the same bytes.
    put(join(to, 'keys', 'fp.anchor'), 'anchor');

    const moved = movePrivateTree(left(from, own), to);
    expect(moved).toEqual({ tails: ['fp-1'], closed: [], kept: [], emptied: true });
    expect(readFileSync(join(to, 'tails', 'fp-1', 'seg'), 'utf-8')).toBe('events');
    expect(readFileSync(join(to, 'keys', 'fp.pub'), 'utf-8')).toBe('pub');
    expect(readFileSync(join(own, 'keys', 'fp.inst'), 'utf-8')).toBe('1\n');
    expect(existsSync(join(to, 'locks'))).toBe(false);
    expect(existsSync(from)).toBe(false);
  });

  it('closes the old tail where the worktree already has an installation id, and writes over nothing', () => {
    const from = join(sandbox, 'old');
    const to = join(sandbox, 'shared');
    const own = join(sandbox, 'own');
    put(join(from, 'tails', 'fp-1', 'seg'), 'events');
    put(join(from, 'keys', 'fp.inst'), '1\n');
    put(join(own, 'keys', 'fp.inst'), '2\n');
    put(join(from, 'keys', 'fp.anchor'), 'one anchor');
    put(join(to, 'keys', 'fp.anchor'), 'another anchor');

    const moved = movePrivateTree(left(from, own), to);
    expect(moved).toEqual({
      tails: ['fp-1'],
      closed: ['fp-1'],
      kept: [join(from, 'keys', 'fp.anchor')],
      emptied: false,
    });
    expect(readFileSync(join(own, 'keys', 'fp.inst'), 'utf-8')).toBe('2\n');
    expect(readFileSync(join(to, 'keys', 'fp.anchor'), 'utf-8')).toBe('another anchor');
    expect(readFileSync(join(from, 'keys', 'fp.anchor'), 'utf-8')).toBe('one anchor');
  });
});
