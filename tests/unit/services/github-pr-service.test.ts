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
