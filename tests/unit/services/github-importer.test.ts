import { describe, expect, it, vi } from 'vitest';

import {
  GithubIssuesImporter,
  parseNextLink,
} from '@/services/importers/github-issues-importer.js';
import type { TaskService } from '@/services/task-service.js';

describe('parseNextLink', () => {
  it('returns the next-page URL when present', () => {
    const header =
      '<https://api.github.com/repositories/1/issues?page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/issues?page=10>; rel="last"';
    expect(parseNextLink(header)).toBe('https://api.github.com/repositories/1/issues?page=2');
  });

  it('returns null when no `next` relation is set', () => {
    const header = '<https://api.github.com/repositories/1/issues?page=10>; rel="last"';
    expect(parseNextLink(header)).toBeNull();
  });

  it('returns null for empty or null inputs', () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('')).toBeNull();
  });
});

describe('GithubIssuesImporter', () => {
  const fakeIssue = {
    number: 1,
    title: 'Implement OAuth',
    body: 'Add Google flow',
    state: 'open' as const,
    labels: ['enhancement', { name: 'priority:high' }],
  };

  function makeFetch(payload: unknown): typeof fetch {
    return vi.fn(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  }

  it('skips pull requests and creates tasks for plain issues', async () => {
    const created: { title: string }[] = [];
    const tasks = {
      create: ({ title }: { title: string }) => {
        created.push({ title });
        return { ok: true as const, value: { key: 'X-1', state: 'DRAFT' } as never };
      },
    } as unknown as TaskService;

    const importer = new GithubIssuesImporter(
      tasks,
      'TEST',
      'daniel',
      makeFetch([fakeIssue, { ...fakeIssue, number: 2, pull_request: {} }]),
    );

    const summary = await importer.import('owner/repo');
    expect(summary.tasksCreated).toBe(1);
    expect(summary.skipped.map((s) => s.reason)).toEqual(['pull_request_skipped']);
    expect(created).toEqual([{ title: 'Implement OAuth' }]);
  });

  it('throws when GitHub returns a non-2xx status', async () => {
    const tasks = {
      create: () => ({ ok: true, value: {} as never }),
    } as unknown as TaskService;
    const fetcher = vi.fn(async () => new Response('rate limit', { status: 403 }));
    const importer = new GithubIssuesImporter(tasks, 'TEST', 'daniel', fetcher);

    await expect(importer.import('owner/repo')).rejects.toThrow(/GitHub API 403/);
  });
});
