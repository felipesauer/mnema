import { describe, expect, it } from 'vitest';

import {
  type CommandResult,
  type CommandRunner,
  GitHubPrService,
} from '@/services/github-pr-service.js';

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
