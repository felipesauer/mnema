import { describe, expect, it } from 'vitest';

import {
  type CommandResult,
  type CommandRunner,
  GitHubPrService,
} from '@/services/git/github-pr-service.js';

const URL = 'https://github.com/felipesauer/mnema/pull/42';

function runnerReturning(result: Partial<CommandResult>): CommandRunner {
  return () => ({ status: 0, stdout: '', ...result });
}

describe('GitHubPrService', () => {
  it('reports a merged PR with green CI', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({
        state: 'MERGED',
        mergedAt: '2026-06-30T00:00:00Z',
        statusCheckRollup: [{ state: 'SUCCESS' }, { state: 'SUCCESS' }],
      }),
    });
    const status = new GitHubPrService(runner).status(URL);
    expect(status.available).toBe(true);
    expect(status.ref).toBe('felipesauer/mnema#42');
    expect(status.state).toBe('merged');
    expect(status.merged).toBe(true);
    expect(status.ci).toBe('passing');
  });

  it('reports an open PR with failing CI', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({
        state: 'OPEN',
        mergedAt: null,
        statusCheckRollup: [{ state: 'SUCCESS' }, { state: 'FAILURE' }],
      }),
    });
    const status = new GitHubPrService(runner).status(URL);
    expect(status.state).toBe('open');
    expect(status.merged).toBe(false);
    expect(status.ci).toBe('failing');
  });

  it('reports a failing GitHub Actions check (CheckRun shape, no `state`)', () => {
    // Modern Actions checks carry status+conclusion and NO `state`.
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({
        state: 'OPEN',
        mergedAt: null,
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
      }),
    });
    expect(new GitHubPrService(runner).status(URL).ci).toBe('failing');
  });

  it('reports an in-progress GitHub Actions check as pending', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({
        state: 'OPEN',
        mergedAt: null,
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', status: 'IN_PROGRESS' },
        ],
      }),
    });
    expect(new GitHubPrService(runner).status(URL).ci).toBe('pending');
  });

  it('reports all-passing GitHub Actions checks as passing', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({
        state: 'MERGED',
        mergedAt: '2026-06-30T00:00:00Z',
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
        ],
      }),
    });
    expect(new GitHubPrService(runner).status(URL).ci).toBe('passing');
  });

  it('rejects look-alike hosts (mygithub.com / notgithub.com)', () => {
    let invoked = false;
    const runner: CommandRunner = () => {
      invoked = true;
      return { status: 0, stdout: '' };
    };
    for (const bad of [
      'https://mygithub.com/o/r/pull/42',
      'https://notgithub.com/o/r/pull/42',
      'https://github.com.evil.com/o/r/pull/42',
    ]) {
      const status = new GitHubPrService(runner).status(bad);
      expect(status.available, bad).toBe(false);
      expect(status.ref, bad).toBeNull();
    }
    expect(invoked).toBe(false);
  });

  it('accepts a www. host and a trailing path/query', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN', mergedAt: null, statusCheckRollup: [] }),
    });
    for (const good of [
      'https://www.github.com/felipesauer/mnema/pull/42',
      'https://github.com/felipesauer/mnema/pull/42/files',
      'https://github.com/felipesauer/mnema/pull/42?diff=split',
    ]) {
      expect(new GitHubPrService(runner).status(good).ref, good).toBe('felipesauer/mnema#42');
    }
  });

  it('reports pending CI', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({
        state: 'OPEN',
        mergedAt: null,
        statusCheckRollup: [{ state: 'SUCCESS' }, { state: 'PENDING' }],
      }),
    });
    expect(new GitHubPrService(runner).status(URL).ci).toBe('pending');
  });

  it('reports no checks as ci=none', () => {
    const runner = runnerReturning({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN', mergedAt: null, statusCheckRollup: [] }),
    });
    expect(new GitHubPrService(runner).status(URL).ci).toBe('none');
  });

  it('degrades gracefully when gh is not installed', () => {
    const runner: CommandRunner = () => ({
      status: null,
      stdout: '',
      error: new Error('spawn gh ENOENT'),
    });
    const status = new GitHubPrService(runner).status(URL);
    expect(status.available).toBe(false);
    expect(status.state).toBe('unknown');
    expect(status.reason).toContain('gh not available');
  });

  it('degrades gracefully when gh exits non-zero (unauth/offline)', () => {
    const runner = runnerReturning({ status: 1, stdout: '' });
    const status = new GitHubPrService(runner).status(URL);
    expect(status.available).toBe(false);
    expect(status.reason).toContain('could not resolve');
  });

  it('rejects an unparseable URL without invoking gh', () => {
    let invoked = false;
    const runner: CommandRunner = () => {
      invoked = true;
      return { status: 0, stdout: '' };
    };
    const status = new GitHubPrService(runner).status('https://example.com/not-a-pr');
    expect(invoked).toBe(false);
    expect(status.available).toBe(false);
    expect(status.ref).toBeNull();
    expect(status.reason).toContain('pull-request URL');
  });

  it('degrades gracefully on unparseable gh output', () => {
    const runner = runnerReturning({ status: 0, stdout: 'not json' });
    const status = new GitHubPrService(runner).status(URL);
    expect(status.available).toBe(false);
    expect(status.reason).toContain('parse');
  });
});

/**
 * A runner that routes by subcommand: `pr view` → the view payload, and each
 * `gh api .../commits/<sha>/{check-runs,status}` → its own fixture. Anything
 * unmatched returns a non-zero exit (so an unexpected call reads as unknown).
 */
function dispatchRunner(fixtures: {
  view: unknown;
  checkRuns?: unknown;
  combinedStatus?: unknown;
}): CommandRunner {
  return (_command, args) => {
    const joined = args.join(' ');
    if (args[0] === 'pr' && args[1] === 'view') {
      return { status: 0, stdout: JSON.stringify(fixtures.view) };
    }
    if (args[0] === 'api' && joined.includes('/check-runs')) {
      return fixtures.checkRuns === undefined
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: JSON.stringify(fixtures.checkRuns) };
    }
    if (args[0] === 'api' && joined.endsWith('/status')) {
      return fixtures.combinedStatus === undefined
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: JSON.stringify(fixtures.combinedStatus) };
    }
    return { status: 1, stdout: '' };
  };
}

const mergedView = {
  state: 'MERGED',
  mergedAt: '2026-06-30T00:00:00Z',
  statusCheckRollup: [{ state: 'SUCCESS' }], // GREEN head
  mergeCommit: { oid: 'deadbeefcafe' },
  baseRefName: 'main',
};

describe('GitHubPrService base-branch CI (merge commit)', () => {
  it('surfaces a RED base even when the PR head was green', () => {
    const status = new GitHubPrService(
      dispatchRunner({
        view: mergedView,
        checkRuns: { check_runs: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] },
        combinedStatus: { state: 'success', statuses: [] },
      }),
    ).status(URL);
    expect(status.merged).toBe(true);
    expect(status.ci).toBe('passing'); // head still green (compat)
    expect(status.ciBase).toBe('failing'); // but the base broke post-merge
    expect(status.mergeCommit).toBe('deadbeefcafe');
  });

  it('reports a green base when the merge commit passed', () => {
    const status = new GitHubPrService(
      dispatchRunner({
        view: mergedView,
        checkRuns: { check_runs: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] },
        combinedStatus: { state: 'success', statuses: [] },
      }),
    ).status(URL);
    expect(status.ciBase).toBe('passing');
  });

  it('treats an in-progress base run as pending', () => {
    const status = new GitHubPrService(
      dispatchRunner({
        view: mergedView,
        checkRuns: { check_runs: [{ status: 'IN_PROGRESS' }] },
        combinedStatus: { state: 'pending', statuses: [] },
      }),
    ).status(URL);
    expect(status.ciBase).toBe('pending');
  });

  it('ciBase is unknown (never a false green) when the gh api lookups fail', () => {
    // dispatchRunner returns non-zero for the api calls (no fixtures given).
    const status = new GitHubPrService(dispatchRunner({ view: mergedView })).status(URL);
    expect(status.ci).toBe('passing'); // head resolved
    expect(status.ciBase).toBe('unknown'); // base lookups failed → unknown
  });

  it('never lets a merge-blocking check-run be masked by a green legacy status', () => {
    // An ACTION_REQUIRED (or STALE / empty-conclusion) COMPLETED run is
    // merge-blocking on GitHub. It must read as failing, not be dropped so a
    // green combined-status paints the base green.
    const status = new GitHubPrService(
      dispatchRunner({
        view: mergedView,
        checkRuns: { check_runs: [{ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }] },
        combinedStatus: { state: 'success', statuses: [{ state: 'success' }] },
      }),
    ).status(URL);
    expect(status.ciBase).toBe('failing');
  });

  it('does not query the base for an OPEN (unmerged) PR', () => {
    let apiCalled = false;
    const runner: CommandRunner = (_c, args) => {
      if (args[0] === 'api') apiCalled = true;
      if (args[0] === 'pr') {
        return {
          status: 0,
          stdout: JSON.stringify({ state: 'OPEN', mergedAt: null, statusCheckRollup: [] }),
        };
      }
      return { status: 1, stdout: '' };
    };
    const status = new GitHubPrService(runner).status(URL);
    expect(status.merged).toBe(false);
    expect(status.ciBase).toBe('unknown');
    expect(apiCalled).toBe(false);
  });
});
