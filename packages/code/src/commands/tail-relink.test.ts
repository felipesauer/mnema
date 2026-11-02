/**
 * The adapter behind `mnema tail relink`: which tree it writes in, which key signs, what reaches the
 * operation, and what it hands back. The relink itself, its refusals and both readers over it are
 * held in `@mnema/core` (`relink-operations.test.ts`) and on the binary
 * (`tests/the-owner-relinks-a-tail.test.ts`); this file holds what the wiring adds: the tree is
 * the one that holds the tails, the key is the person's found under the `HOME` given, `--into`
 * reaches the operation, and a refusal comes back with the operation's code.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
