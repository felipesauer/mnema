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

/**
 * A whole identity no record here knows: accepted as written (the shape is the
 * shape), and matching nothing. It is what a stranger looks like now that a value
 * naming no identity at all is refused rather than answered about.
 */
const STRANGER = `mnid:${'0'.repeat(64)}`;

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
    const other = runFocus({ cwd: repo, env }, { actor: STRANGER });
    expect(other.ok).toBe(true);
    if (other.ok) expect(other.focus.openRuns).toEqual([]);

    // The machine's own anchor sees its run.
    const mine = runFocus({ cwd: repo, env }, { actor: who });
    if (mine.ok) expect(mine.focus.openRuns).toHaveLength(1);
  });

  it('refuses an actor that names no identity, and names the ones it knows', () => {
    // Not an empty focus: an answer about somebody the record has never heard of
    // reads exactly like an answer about somebody real with nothing open.
    const { repo, env, who } = projectWithRuns();
    const refused = runFocus({ cwd: repo, env }, { actor: 'somebody-else' });
    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ANCHOR' });
    expect((refused as { message: string }).message).toContain(who.slice(0, 13));
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

  it('ages every open run, against the clock it is given', () => {
    // A command-line read has no session of its own, so what makes a list of leftover
    // runs readable here is the age. The clock is injected for the same reason the
    // core injects one: an age is only assertable against a pinned instant.
    const { repo, env, who, ctx } = projectWithRuns();
    // Both instants pinned: the run's own `at` through the core's injectable clock,
    // and the asker's through the command's.
    const startedAt = '2026-07-21T00:00:00.000Z';
    const opened = startRun({ ...ctx, clock: () => startedAt }, { agent: 'test-agent' });
    if (!opened.ok) throw new Error('setup: startRun refused');
    ctx.writer.checkpoint();

    const later = '2026-07-21T02:00:00.000Z';
    const result = runFocus({ cwd: repo, env, clock: () => later }, { actor: who });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.focus.openRuns[0]?.ageSeconds).toBe(7200);
  });

  it('reports every run as NOT this command’s own, because a read opens none', () => {
    // True by construction rather than by policy: `runFocus` opens no writer. It is
    // also why the human output stays silent about it — a value that is the same in
    // every line is noise — while `--json` carries it.
    const { repo, env, who, ctx } = projectWithRuns();
    startRun(ctx, { agent: 'test-agent' });
    ctx.writer.checkpoint();

    const result = runFocus({ cwd: repo, env }, { actor: who });
    if (result.ok) expect(result.focus.openRuns.map((r) => r.thisSession)).toEqual([false]);
  });
});
