import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { endRun, openTreeForWriting, startRun, type WriteContext } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runResume } from './resume.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-resume-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/**
 * A write context onto the private tree with a CONTROLLABLE clock — so two runs
 * get distinct `startedAt` values and "latest run" is unambiguous (the default
 * system clock can stamp two same-millisecond runs identically, leaving the
 * order to the random id tail, which is not creation order).
 */
function privateContext(repo: string, env: DiscoveryEnv, now: () => string): WriteContext {
  const trees = resolveTrees(repo, env);
  return {
    writer: openTreeForWriting(trees, 'private'),
    layout: { root: chainRootForScope(trees, 'private') as string },
    upcasters: catalogUpcasters(),
    clock: now,
  };
}

function projectWithRuns(now: () => string = () => '2026-01-01T00:00:00.000Z'): {
  repo: string;
  env: DiscoveryEnv;
  who: string;
  ctx: WriteContext;
} {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const ctx = privateContext(repo, env, now);
  return { repo, env, who: ctx.writer.anchor, ctx };
}

describe('mnema resume', () => {
  it('reports the latest run EVEN IF it has ended, plus the open focus', () => {
    // Two distinct timestamps so "latest" is decided by startedAt, not id order.
    const clock = { at: '2026-01-01T00:00:01.000Z' };
    const { repo, env, who, ctx } = projectWithRuns(() => clock.at);
    const first = startRun(ctx, { agent: 'test-agent', goal: 'first' });
    clock.at = '2026-01-01T00:00:02.000Z';
    const last = startRun(ctx, { agent: 'test-agent', goal: 'last' });
    if (!first.ok || !last.ok) throw new Error('setup');
    // End the latest run — resume must still report it as the "where was I" anchor.
    endRun(ctx, { run: last.id });
    ctx.writer.checkpoint();

    const result = runResume({ cwd: repo, env }, { actor: who });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resume.lastRun?.id).toBe(last.id);
      expect(result.resume.lastRun?.open).toBe(false);
      expect(result.resume.lastRun?.goal).toBe('last');
      // The ended run is not in focus; the still-open first one is.
      expect(result.resume.focus.openRuns.map((r) => r.id)).toEqual([first.id]);
    }
  });

  it('reports a null lastRun for an actor with no runs', () => {
    const { repo, env } = projectWithRuns();
    const result = runResume({ cwd: repo, env }, { actor: 'nobody-here' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resume.lastRun).toBeNull();
      expect(result.resume.focus.openRuns).toEqual([]);
    }
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup();
    const result = runResume({ cwd: repo, env }, { actor: 'anyone' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
