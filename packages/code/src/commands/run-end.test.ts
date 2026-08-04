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

/** The agent every close in this file is executed by, unless the test says otherwise. */
const AGENT = 'claude-code';

/** Inits and opens a run, returning the project and the run's id. */
function openedRun(agent = AGENT): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const started = runRunStart({ cwd: repo, env }, { agent });
  if (!started.ok) throw new Error('the fixture failed to open a run');
  return { repo, env, id: started.id };
}

/** The events of `root`, so a test can read what actually landed on the envelope. */
function eventsOf(repo: string, env: DiscoveryEnv) {
  const root = resolveTrees(repo, env).projectPublic as string;
  return orderedEvents({ root }, catalogUpcasters());
}

function runsOf(repo: string, env: DiscoveryEnv) {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectRuns(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema run end', () => {
  it('closes an open run, recording its outcome', () => {
    const { repo, env, id } = openedRun();

    const result = runRunEnd({ cwd: repo, env }, { run: id, which: AGENT, outcome: 'shipped' });
    expect(result).toEqual({ ok: true, id, agent: AGENT });
    const run = runsOf(repo, env).get(id);
    expect(run?.open).toBe(false);
    expect(run?.outcome).toBe('shipped');
  });

  it('closes without an outcome (the note is optional)', () => {
    const { repo, env, id } = openedRun();
    expect(runRunEnd({ cwd: repo, env }, { run: id, which: AGENT }).ok).toBe(true);
    expect(runsOf(repo, env).get(id)?.open).toBe(false);
  });

  it('refuses ALREADY_ENDED on a second close — never silently', () => {
    // A duplicate `run.ended` on an append-only log cannot be retracted, and a
    // close that quietly does nothing would let a person believe the second one
    // took effect.
    const { repo, env, id } = openedRun();
    expect(runRunEnd({ cwd: repo, env }, { run: id, which: AGENT }).ok).toBe(true);

    const again = runRunEnd({ cwd: repo, env }, { run: id, which: AGENT, outcome: 'again' });
    expect(again).toMatchObject({ ok: false, reason: 'REFUSED', code: 'ALREADY_ENDED' });
    // Exactly one close was recorded, and the first outcome stands.
    const root = resolveTrees(repo, env).projectPublic as string;
    const ended = orderedEvents({ root }, catalogUpcasters()).filter(
      (e) => e.kind === 'run.ended' && e.subject === id,
    );
    expect(ended).toHaveLength(1);
    expect(runsOf(repo, env).get(id)?.outcome).toBeUndefined();
  });

  it('refuses UNKNOWN_RUN for an id this project has no record of', () => {
    const { repo, env } = openedRun();
    const result = runRunEnd(
      { cwd: repo, env },
      { run: '00000000-0000-7000-8000-000000000000', which: AGENT },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_RUN' });
  });

  it('a run opened in ANOTHER project is unknown here', () => {
    // A run belongs to the private tree of the project it was opened in; a second
    // project cannot close (or vouch for) a session it never saw.
    const { repo, env, id } = openedRun();
    const other = join(sandbox, 'other-repo');
    mkdirSync(other, { recursive: true });
    runInit({ cwd: other, env });

    const result = runRunEnd({ cwd: other, env }, { run: id, which: AGENT });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_RUN' });
    // And it is still open where it lives.
    expect(runsOf(repo, env).get(id)?.open).toBe(true);
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { env, id } = openedRun();
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    expect(runRunEnd({ cwd: orphan, env }, { run: id, which: AGENT })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });

  it('leaves the tree fully signed after closing a run', () => {
    const { repo, env, id } = openedRun();
    runRunEnd({ cwd: repo, env }, { run: id, which: AGENT, outcome: 'done' });
    const verdict = verify(resolveTrees(repo, env).projectPublic as string);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('records the agent that closed it on the envelope, and reports it AS RECORDED', () => {
    const { repo, env, id } = openedRun();

    // A non-canonical spelling goes in; the canonical one is what lands and what the
    // adapter echoes, so a caller printing this cannot print what it typed instead.
    const result = runRunEnd({ cwd: repo, env }, { run: id, which: '  claude-code  ' });
    expect(result).toMatchObject({ ok: true, agent: AGENT });
    const ended = eventsOf(repo, env).find((e) => e.kind === 'run.ended');
    expect(ended?.which).toBe(AGENT);
  });

  it('and the pair names ONE agent — the close credits whom the birth opened it for', () => {
    // The defect this closes, at the surface: a session opened `for claude-code` used
    // to be sealed, in the record, by the person — the close carried no agent at all.
    const { repo, env, id } = openedRun();
    expect(runRunEnd({ cwd: repo, env }, { run: id, which: AGENT }).ok).toBe(true);

    const session = eventsOf(repo, env).filter((e) => e.kind.startsWith('run.'));
    expect(session.map((e) => e.kind)).toEqual(['run.started', 'run.ended']);
    expect(session.map((e) => e.which)).toEqual([AGENT, AGENT]);
  });

  it('refuses NO_AGENT for a `--which` that names nobody, and the run stays open', () => {
    // The same guard the half that OPENS a run applies, in the same place: this pair
    // is how an agent driving the command line gets a session, so a close with no
    // executor would be recorded as the person's — the fiction naming it exists to
    // close. Reached with a variable that expanded to nothing, never typed.
    const { repo, env, id } = openedRun();

    const result = runRunEnd({ cwd: repo, env }, { run: id, which: '   ' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'NO_AGENT' });
    expect(runsOf(repo, env).get(id)?.open).toBe(true);
    // And nothing was written: the guard runs before any tree is opened.
    expect(eventsOf(repo, env).some((e) => e.kind === 'run.ended')).toBe(false);
  });

  it('forwards WHO_IS_WHICH when the closing agent IS the anchor that authorized it', () => {
    // The core's rule, reaching this surface: an agent must not seal a session as the
    // identity that authorized the work. The anchor is what `mnema accountability`
    // prints, so this is typed, not synthesized.
    const { repo, env, id } = openedRun();
    const anchor = runsOf(repo, env).get(id)?.who as string;

    const result = runRunEnd({ cwd: repo, env }, { run: id, which: anchor });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'WHO_IS_WHICH' });
    expect(runsOf(repo, env).get(id)?.open).toBe(true);
  });
});
