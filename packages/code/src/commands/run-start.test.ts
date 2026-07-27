import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectRuns, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runRunStart } from './run-start.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-run-start-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** The events of a tree root, or [] when the tree was never written. */
function eventsOf(root: string | undefined) {
  return root === undefined ? [] : orderedEvents({ root }, catalogUpcasters());
}

describe('mnema run start', () => {
  it('opens a run for the named agent, returning its minted id', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runRunStart({ cwd: repo, env }, { agent: 'claude-code' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.agent).toBe('claude-code');
      const trees = resolveTrees(repo, env);
      const run = projectRuns(eventsOf(trees.projectPrivate)).get(result.id);
      expect(run?.open).toBe(true);
      expect(run?.agent).toBe('claude-code');
    }
  });

  it('is born PRIVATE: the team tree never sees the session', () => {
    // A run is this machine's session, not the team's work. It has no --scope, so
    // this is the only tree it can land in — and the public one must stay clean.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runRunStart({ cwd: repo, env }, { agent: 'ci-runner' });
    expect(result.ok).toBe(true);

    const trees = resolveTrees(repo, env);
    expect(eventsOf(trees.projectPrivate).map((e) => e.kind)).toContain('run.started');
    expect(eventsOf(trees.projectPublic).some((e) => e.kind === 'run.started')).toBe(false);
    expect(eventsOf(trees.global).some((e) => e.kind === 'run.started')).toBe(false);
  });

  it('records the goal, the authorizing anchor, and the agent on both slots', () => {
    // The agent lives in the payload (the projection reads it) AND on the
    // envelope's `which` (what every other fact uses) — one declaration, both.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runRunStart({ cwd: repo, env }, { agent: 'codex', goal: 'ship the CLI run' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      const started = eventsOf(trees.projectPrivate).find(
        (e) => e.kind === 'run.started' && e.subject === result.id,
      );
      expect(started?.which).toBe('codex');
      expect(started?.who).toMatch(/^mnid:[0-9a-f]{64}$/);
      const run = projectRuns(eventsOf(trees.projectPrivate)).get(result.id);
      expect(run?.goal).toBe('ship the CLI run');
      expect(run?.who).toBe(started?.who);
    }
  });

  it('refuses NO_AGENT for a blank agent — a run with no agent authorizes nothing', () => {
    // The core would read a blank as "no agent" and record a run naming nobody:
    // the correlation-id run the design rejected. It is refused at the door.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    for (const agent of ['', '   ', '\t\n']) {
      const result = runRunStart({ cwd: repo, env }, { agent });
      expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'NO_AGENT' });
    }
    // Nothing was written by any of the three attempts.
    const trees = resolveTrees(repo, env);
    expect(eventsOf(trees.projectPrivate).some((e) => e.kind === 'run.started')).toBe(false);
  });

  it('trims the agent instead of discarding it (the core’s own identity rule)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runRunStart({ cwd: repo, env }, { agent: '  claude-code  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent).toBe('claude-code');
  });

  it('refuses WHO_IS_WHICH when the agent IS the authorizing identity', () => {
    // An agent must not open the session that authorizes its own work — the whole
    // session would inherit a `who` the agent chose for itself.
    const { repo, env } = setup();
    const init = runInit({ cwd: repo, env });

    const result = runRunStart({ cwd: repo, env }, { agent: init.anchor });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'WHO_IS_WHICH' });
    const trees = resolveTrees(repo, env);
    expect(eventsOf(trees.projectPrivate).some((e) => e.kind === 'run.started')).toBe(false);
  });

  it('refuses NO_PROJECT outside a project (a run belongs to a project)', () => {
    // Falling back to the global tree would open a session no CLI read surfaces:
    // focus/resume read the project's private tree, so it could never be resumed.
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runRunStart({ cwd: orphan, env }, { agent: 'claude-code' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('leaves the tree fully signed after opening a run', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runRunStart({ cwd: repo, env }, { agent: 'claude-code' });
    const root = resolveTrees(repo, env).projectPrivate as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });
});
