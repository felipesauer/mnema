import type { TaskService } from '../task-service.js';

/**
 * Subset of the GitHub Issues REST API payload that the importer
 * actually consumes. Avoids pulling the full Octokit type tree.
 */
interface GithubIssue {
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly state: 'open' | 'closed';
  readonly state_reason?: 'completed' | 'reopened' | 'not_planned' | null;
  readonly user?: { readonly login?: string };
  readonly labels?: ReadonlyArray<string | { readonly name?: string }>;
  /** Pull requests come in the issues endpoint too — we skip them. */
  readonly pull_request?: unknown;
}

/**
 * Outcome of {@link GithubIssuesImporter.import}.
 */
export interface GithubImportSummary {
  readonly issuesScanned: number;
  readonly tasksCreated: number;
  readonly skipped: readonly { number: number; reason: string }[];
}

/**
 * Minimal interface for the HTTP client. Tests inject a fake; production
 * uses Node's built-in `fetch`.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Imports GitHub Issues into Mnema tasks via the REST API.
 *
 * Mapping (per DESIGN.md §7.2):
 * - open issue              → task in initial state
 * - closed (completed)      → task in initial state, then transitioned to DONE
 * - closed (not_planned)    → task in initial state, then transitioned to CANCELED
 * - issue body              → description
 * - labels                  → metadata.labels (free-form)
 * - issue author            → audit `actor` (the human running the import
 *   stays as the canonical actor; author goes in metadata)
 *
 * Pull requests are skipped — the issues endpoint includes them too.
 * Pagination follows the `Link: rel="next"` header until exhausted.
 *
 * Importers are **one-shot**: a second invocation duplicates tasks.
 */
export class GithubIssuesImporter {
  private static readonly USER_AGENT = '@saurim/mnema importer';

  constructor(
    private readonly tasks: TaskService,
    private readonly projectKey: string,
    private readonly actor: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  /**
   * Imports issues from a `owner/repo` slug.
   *
   * @param repo - Repository in `owner/repo` form
   * @param options - `state` filter (`open`/`closed`/`all`, default `all`)
   *   and optional `token` for authenticated calls
   * @returns Summary describing how many issues were scanned and tasks created
   */
  async import(
    repo: string,
    options: {
      readonly state?: 'open' | 'closed' | 'all';
      readonly token?: string;
    } = {},
  ): Promise<GithubImportSummary> {
    const skipped: { number: number; reason: string }[] = [];
    const issues = await this.fetchAllIssues(repo, options);

    let created = 0;
    for (const issue of issues) {
      if (issue.pull_request !== undefined) {
        skipped.push({ number: issue.number, reason: 'pull_request_skipped' });
        continue;
      }

      const labels = (issue.labels ?? [])
        .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
        .filter((label): label is string => label.length > 0);
      const author = issue.user?.login;

      const result = this.tasks.create({
        projectKey: this.projectKey,
        title: issue.title,
        description: issue.body ?? undefined,
        actor: this.actor,
        metadata: {
          source: 'github',
          issue_number: issue.number,
          ...(author !== undefined ? { author } : {}),
          ...(labels.length > 0 ? { labels } : {}),
        },
      });
      if (!result.ok) {
        skipped.push({ number: issue.number, reason: String(result.error.kind) });
        continue;
      }
      created += 1;
    }

    return { issuesScanned: issues.length, tasksCreated: created, skipped };
  }

  /**
   * Walks every page of the issues endpoint, returning a single flat
   * array. The function is `protected`-friendly — callers can override
   * to inject canned responses.
   */
  private async fetchAllIssues(
    repo: string,
    options: { readonly state?: 'open' | 'closed' | 'all'; readonly token?: string },
  ): Promise<GithubIssue[]> {
    const state = options.state ?? 'all';
    const initial = `https://api.github.com/repos/${repo}/issues?state=${state}&per_page=100`;
    let nextUrl: string | null = initial;
    const issues: GithubIssue[] = [];

    while (nextUrl !== null) {
      const headers: Record<string, string> = {
        'User-Agent': GithubIssuesImporter.USER_AGENT,
        Accept: 'application/vnd.github+json',
      };
      if (options.token !== undefined) {
        headers.Authorization = `Bearer ${options.token}`;
      }
      const response = await this.fetcher(nextUrl, { headers });
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status} ${response.statusText} for ${repo}`);
      }
      const page = (await response.json()) as GithubIssue[];
      issues.push(...page);
      nextUrl = parseNextLink(response.headers.get('link') ?? null);
    }

    return issues;
  }
}

/**
 * Extracts the URL with `rel="next"` from a `Link` header. Returns
 * `null` when no `next` relation exists.
 *
 * @param header - Raw `Link` header value
 * @returns The next-page URL or `null`
 */
export function parseNextLink(header: string | null): string | null {
  if (header === null || header.length === 0) return null;
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match === null) continue;
    if (match[2] === 'next') return match[1] ?? null;
  }
  return null;
}
