import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectRuns, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runRunEnd } from './run-end.js';
import { runRunStart } from './run-start.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-run-end-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Inits and opens a run, returning the project and the run's id. */
function openedRun(agent = 'claude-code'): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const started = runRunStart({ cwd: repo, env }, { agent });
  if (!started.ok) throw new Error('the fixture failed to open a run');
  return { repo, env, id: started.id };
}

function runsOf(repo: string, env: DiscoveryEnv) {
  const root = resolveTrees(repo, env).projectPrivate as string;
  return projectRuns(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema run end', () => {
  it('closes an open run, recording its outcome', () => {
    const { repo, env, id } = openedRun();

    const result = runRunEnd({ cwd: repo, env }, { run: id, outcome: 'shipped' });
    expect(result).toEqual({ ok: true, id });
    const run = runsOf(repo, env).get(id);
    expect(run?.open).toBe(false);
    expect(run?.outcome).toBe('shipped');
  });

  it('closes without an outcome (the note is optional)', () => {
    const { repo, env, id } = openedRun();
    expect(runRunEnd({ cwd: repo, env }, { run: id }).ok).toBe(true);
    expect(runsOf(repo, env).get(id)?.open).toBe(false);
  });

  it('refuses ALREADY_ENDED on a second close — never silently', () => {
    // A duplicate `run.ended` on an append-only log cannot be retracted, and a
    // close that quietly does nothing would let a person believe the second one
    // took effect.
    const { repo, env, id } = openedRun();
    expect(runRunEnd({ cwd: repo, env }, { run: id }).ok).toBe(true);

    const again = runRunEnd({ cwd: repo, env }, { run: id, outcome: 'again' });
    expect(again).toMatchObject({ ok: false, reason: 'REFUSED', code: 'ALREADY_ENDED' });
    // Exactly one close was recorded, and the first outcome stands.
    const root = resolveTrees(repo, env).projectPrivate as string;
    const ended = orderedEvents({ root }, catalogUpcasters()).filter(
      (e) => e.kind === 'run.ended' && e.subject === id,
    );
    expect(ended).toHaveLength(1);
    expect(runsOf(repo, env).get(id)?.outcome).toBeUndefined();
  });

  it('refuses UNKNOWN_RUN for an id this project has no record of', () => {
    const { repo, env } = openedRun();
    const result = runRunEnd({ cwd: repo, env }, { run: '00000000-0000-7000-8000-000000000000' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_RUN' });
  });

  it('a run opened in ANOTHER project is unknown here', () => {
    // A run belongs to the private tree of the project it was opened in; a second
    // project cannot close (or vouch for) a session it never saw.
    const { repo, env, id } = openedRun();
    const other = join(sandbox, 'other-repo');
    mkdirSync(other, { recursive: true });
    runInit({ cwd: other, env });

    const result = runRunEnd({ cwd: other, env }, { run: id });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_RUN' });
    // And it is still open where it lives.
    expect(runsOf(repo, env).get(id)?.open).toBe(true);
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { env, id } = openedRun();
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    expect(runRunEnd({ cwd: orphan, env }, { run: id })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });

  it('leaves the tree fully signed after closing a run', () => {
    const { repo, env, id } = openedRun();
    runRunEnd({ cwd: repo, env }, { run: id, outcome: 'done' });
    const verdict = verify(resolveTrees(repo, env).projectPrivate as string);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });
});
