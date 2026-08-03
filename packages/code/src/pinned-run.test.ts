import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './commands/init.js';
import { runRunEnd } from './commands/run-end.js';
import { runRunStart } from './commands/run-start.js';
import { resolvePinnedRun } from './pinned-run.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-pinned-run-'));
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
function openedRun(): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const started = runRunStart({ cwd: repo, env }, { agent: 'claude-code' });
  if (!started.ok) throw new Error('the fixture failed to open a run');
  return { repo, env, id: started.id };
}

/**
 * A discovery env that counts how many times it is READ. Resolving a tree needs
 * it, so a zero count proves the resolution never started — the cheap path.
 */
function countingEnv(env: DiscoveryEnv): { env: DiscoveryEnv; reads: () => number } {
  let reads = 0;
  return {
    env: {
      get home() {
        reads += 1;
        return env.home;
      },
      get xdgDataHome() {
        reads += 1;
        return env.xdgDataHome;
      },
    },
    reads: () => reads,
  };
}

describe('the pinned run (MNEMA_RUN)', () => {
  it('is unpinned when the variable is unset, and resolves NOTHING to say so', () => {
    // The cost guard: with no variable there is no tree resolved and no
    // projection replayed, so a person who never opened a session pays nothing.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const counted = countingEnv(env);

    expect(resolvePinnedRun({ cwd: repo, env: counted.env }, undefined)).toEqual({ ok: true });
    expect(counted.reads()).toBe(0);
  });

  it('reads an empty or blank value as unset (a shell’s partial unset)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const counted = countingEnv(env);

    for (const value of ['', '   ', '\t\n']) {
      expect(resolvePinnedRun({ cwd: repo, env: counted.env }, value)).toEqual({ ok: true });
    }
    expect(counted.reads()).toBe(0);
  });

  it('resolves an OPEN run to the id the projection stores', () => {
    const { repo, env, id } = openedRun();
    const counted = countingEnv(env);

    expect(resolvePinnedRun({ cwd: repo, env: counted.env }, id)).toEqual({ ok: true, run: id });
    // The other half of the cost guard: with a value, the record IS consulted.
    expect(counted.reads()).toBeGreaterThan(0);
  });

  it('trims surrounding whitespace and still returns the canonical id', () => {
    const { repo, env, id } = openedRun();
    expect(resolvePinnedRun({ cwd: repo, env }, `  ${id}\n`)).toEqual({ ok: true, run: id });
  });

  it('refuses UNKNOWN_RUN for a value this project has no record of', () => {
    const { repo, env } = openedRun();
    const result = resolvePinnedRun({ cwd: repo, env }, '00000000-0000-7000-8000-000000000000');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_RUN');
      // The refusal names the variable and the way out.
      expect(result.message).toContain('MNEMA_RUN');
      expect(result.message).toContain('mnema run start');
    }
  });

  it('refuses RUN_ENDED once the session it names has been closed', () => {
    const { repo, env, id } = openedRun();
    expect(runRunEnd({ cwd: repo, env }, { run: id, which: 'claude-code' }).ok).toBe(true);

    const result = resolvePinnedRun({ cwd: repo, env }, id);
    expect(result).toMatchObject({ ok: false, code: 'RUN_ENDED' });
  });

  it('refuses a run opened in ANOTHER project (the run belongs to its project)', () => {
    const { env, id } = openedRun();
    const other = join(sandbox, 'other-repo');
    mkdirSync(other, { recursive: true });
    runInit({ cwd: other, env });

    expect(resolvePinnedRun({ cwd: other, env }, id)).toMatchObject({
      ok: false,
      code: 'UNKNOWN_RUN',
    });
  });

  it('refuses UNPROVEN_RUN outside a project — there is nothing to prove it against', () => {
    const { repo, env, id } = openedRun();
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });

    const result = resolvePinnedRun({ cwd: orphan, env }, id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNPROVEN_RUN');
      expect(result.message).toContain('no mnema project here');
    }
    // The run is untouched where it lives — a refusal here changes nothing there.
    expect(resolvePinnedRun({ cwd: repo, env }, id)).toEqual({ ok: true, run: id });
  });

  it('refuses a value the chain cannot canonicalize', () => {
    const { repo, env } = openedRun();
    // A lone surrogate: not a usable id reference, so it names no run.
    expect(resolvePinnedRun({ cwd: repo, env }, '\ud800')).toMatchObject({
      ok: false,
      code: 'UNKNOWN_RUN',
    });
  });
});
