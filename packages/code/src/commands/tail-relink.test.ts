/**
 * The adapter behind `mnema tail relink`: which tree it writes in, which key signs, what reaches the
 * operation, and what it hands back. The relink itself, its refusals and both readers over it are
 * held in `@mnema/core` (`relink-operations.test.ts`) and on the binary
 * (`tests/the-owner-relinks-a-tail.test.ts`); this file holds what the wiring adds: the tree is
 * the one that holds the tails, the key is the person's found under the `HOME` given, `--into`
 * reaches the operation, and a refusal comes back with the operation's code.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting, verifyChain } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { createTask, openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../tests/support/git-without-maintenance.js';
import { fixPrivateTree } from './doctor.js';
import { runInit } from './init.js';
import { runTailRelink } from './tail-relink.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tail-relink-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A task written in the tree at `root` with the person's key: the tail it landed in. */
function wrote(root: string, keyRoot: string, title: string): string {
  const writer = openChainForWriting(root, { keyRoot });
  const created = createTask(
    { writer, layout: { root }, upcasters: catalogUpcasters() },
    { title },
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);
  return writer.tail;
}

/** A project whose public tree holds its own record and a tail of the person's of another. */
function twoRecords(): { repo: string; env: DiscoveryEnv; host: string; tail: string } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  const trees = resolveTrees(repo, env);
  const pub = trees.projectPublic as string;
  const host = wrote(pub, trees.keyRoot, 'work of this record');
  const elsewhere = join(sandbox, 'elsewhere');
  const tail = wrote(elsewhere, trees.keyRoot, 'work of another record');
  for (const id of readdirSync(join(elsewhere, 'tails'))) {
    cpSync(join(elsewhere, 'tails', id), join(pub, 'tails', id), { recursive: true });
  }
  return { repo, env, host, tail };
}

describe('mnema tail relink', () => {
  it('relinks in the tree that holds the tail, with the key its id names', () => {
    const { repo, env, host, tail } = twoRecords();
    const done = runTailRelink({ cwd: repo, env }, { tails: [tail], reason: 'one project' });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;
    expect(done.scope).toBe('public');
    expect(done.relinks.map((one) => [one.tail, one.host])).toEqual([[tail, host]]);
    expect(done.opened).toEqual([]);
  });

  it('hands --into to the operation', () => {
    const { repo, env, tail } = twoRecords();
    const done = runTailRelink(
      { cwd: repo, env },
      { tails: [tail], into: 'f'.repeat(64), reason: 'one project' },
    );
    expect(done).toMatchObject({ ok: false, reason: 'REFUSED', code: 'NO_TAIL_NAMES_INTO' });
  });

  it('refuses a tail no tree here holds, by its id', () => {
    const { repo, env } = twoRecords();
    const missing = `${'ab'.repeat(32)}-${'cd'.repeat(16)}`;
    const done = runTailRelink({ cwd: repo, env }, { tails: [missing], reason: 'one project' });
    expect(done).toEqual({ ok: false, reason: 'UNKNOWN_TAIL', tail: missing });
  });

  it('refuses outside a project', () => {
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere);
    const done = runTailRelink(
      { cwd: nowhere, env: { home: join(sandbox, 'home') } },
      { tails: [`${'ab'.repeat(32)}-${'cd'.repeat(16)}`], reason: 'one project' },
    );
    expect(done).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('says the new tail it opened, where the tail it relinks was this installation’s own', () => {
    const { repo, env, host, tail } = twoRecords();
    const pub = resolveTrees(repo, env).projectPublic as string;
    // This installation's id named the host; it names the relinked tail now, as on the other
    // side of the merge.
    const fingerprint = tail.slice(0, tail.indexOf('-'));
    writeFileSync(join(pub, 'keys', `${fingerprint}.inst`), tail.slice(fingerprint.length + 1));
    rmSync(join(pub, 'locks'), { recursive: true, force: true });
    const done = runTailRelink({ cwd: repo, env }, { tails: [tail], reason: 'one project' });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;
    expect(done.opened.map((one) => one.from)).toEqual([tail]);
    expect(done.relinks[0]?.host).not.toBe(host);
    expect(done.relinks[0]?.host).toBe(done.opened[0]?.to);
  });
});

describe('mnema doctor --fix private-tree, over a tree that names another record', () => {
  /** A repository whose private tree names a record, and an old tree beside it that names another. */
  function aRepositoryAndAnOldTree(oldKeyRoot?: string) {
    const repo = join(sandbox, 'repo');
    mkdirSync(repo, { recursive: true });
    const env = { home: join(sandbox, 'home') };
    const git = spawnSync('git', ['init', '-q', '.'], {
      cwd: repo,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: env.home,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    });
    expect(git.status).toBe(0);
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);
    const shared = trees.projectPrivate as string;
    const writer = openTreeForWriting(trees, 'private');
    const made = createTask(
      { writer, layout: { root: shared }, upcasters: catalogUpcasters() },
      { title: 'in the repository' },
    );
    expect(made.ok, JSON.stringify(made)).toBe(true);
    writer.checkpoint();
    const old = join(repo, '.mnema', 'private');
    const tail = wrote(old, oldKeyRoot ?? trees.keyRoot, 'before the repository');
    const ctx = { cwd: repo, env, processEnv: {}, running: { file: '', version: '0.0.0' } };
    return { ctx, shared, old, tail };
  }

  it('relinks each tail by its own key in the tree that stays, then moves it, and both verify', () => {
    const { ctx, shared, tail } = aRepositoryAndAnOldTree();
    const dry = fixPrivateTree(ctx, { dryRun: true });
    expect(dry.lines.join('\n')).toContain('would relink 1 tail(s) into record ');
    const fixed = fixPrivateTree(ctx, { dryRun: false });
    expect(fixed.refused, fixed.lines.join('\n')).toBe(false);
    expect(fixed.lines.join('\n')).toContain('relinked 1 tail(s) into record ');
    expect(readdirSync(join(shared, 'tails'))).toContain(tail);
    const verified = verifyChain({ root: shared }, catalogUpcasters());
    expect(verified.issues).toEqual([]);
    expect(verified.census.filter((note) => note.kind === 'relinked-tail')).toHaveLength(1);
  });

  it('relinks nothing and moves nothing where a tail’s key is not on this machine', () => {
    const { ctx, old, tail } = aRepositoryAndAnOldTree(join(sandbox, 'another-machine'));
    const fixed = fixPrivateTree(ctx, { dryRun: false });
    expect(fixed.refused).toBe(true);
    expect(fixed.lines.join('\n')).toContain(`this machine holds no key for ${tail}`);
    expect(readdirSync(join(old, 'tails'))).toEqual([tail]);
  });
});
