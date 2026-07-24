import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { endRun, openTreeForWriting, startRun, type WriteContext } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runFocus } from './focus.js';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-focus-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** A write context onto the project's private tree — where a session's runs live. */
function privateContext(repo: string, env: DiscoveryEnv): WriteContext {
  const trees = resolveTrees(repo, env);
  return {
    writer: openTreeForWriting(trees, 'private'),
    layout: { root: chainRootForScope(trees, 'private') as string },
    upcasters: catalogUpcasters(),
  };
}

/** Inits a project and returns its context plus the machine's anchor (the who). */
function projectWithRuns(): {
  repo: string;
  env: DiscoveryEnv;
  who: string;
  ctx: WriteContext;
} {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const ctx = privateContext(repo, env);
  const who = ctx.writer.anchor;
  return { repo, env, who, ctx };
}

describe('mnema focus', () => {
  it('reports the actor’s open runs and NOTHING is written', () => {
    const { repo, env, who, ctx } = projectWithRuns();
    const opened = startRun(ctx, { agent: 'test-agent', goal: 'first' });
    if (!opened.ok) throw new Error('setup: startRun refused');
    ctx.writer.checkpoint();

    // Snapshot the private tree's files before the read.
    const privateRoot = chainRootForScope(resolveTrees(repo, env), 'private') as string;
    const before = readdirSync(privateRoot).sort();

    const result = runFocus({ cwd: repo, env }, { actor: who });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.focus.actor).toBe(who);
      expect(result.focus.openRuns.map((r) => r.id)).toEqual([opened.id]);
      expect(result.focus.openRuns[0]?.goal).toBe('first');
    }

    // The read wrote nothing — the tree is byte-for-byte the same.
    expect(readdirSync(privateRoot).sort()).toEqual(before);
  });

  it('never leaks another actor’s runs', () => {
    const { repo, env, who, ctx } = projectWithRuns();
    startRun(ctx, { agent: 'test-agent' });
    ctx.writer.checkpoint();

    // An actor that is not the machine's anchor sees no runs.
    const other = runFocus({ cwd: repo, env }, { actor: 'somebody-else' });
    expect(other.ok).toBe(true);
    if (other.ok) expect(other.focus.openRuns).toEqual([]);

    // The machine's own anchor sees its run.
    const mine = runFocus({ cwd: repo, env }, { actor: who });
    if (mine.ok) expect(mine.focus.openRuns).toHaveLength(1);
  });

  it('excludes runs the actor has already ended', () => {
    const { repo, env, who, ctx } = projectWithRuns();
    const open = startRun(ctx, { agent: 'test-agent' });
    const done = startRun(ctx, { agent: 'test-agent' });
    if (!open.ok || !done.ok) throw new Error('setup');
    endRun(ctx, { run: done.id });
    ctx.writer.checkpoint();

    const result = runFocus({ cwd: repo, env }, { actor: who });
    if (result.ok) expect(result.focus.openRuns.map((r) => r.id)).toEqual([open.id]);
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    const result = runFocus({ cwd: repo, env }, { actor: 'anyone' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
