/**
 * The three things the Action asks of GitHub, over `fetch` with a token.
 *
 * `fetch` is a parameter so nothing here needs a network to be exercised. The token is sent as a
 * bearer credential to the API address it is built with and to no other.
 */

import { MARKER } from './comment.js';
import type { Review } from './governed.js';

/** The `fetch` this module needs: the platform's, or a stand-in. */
export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The platform's own, the one place this package names the global; `run.ts` only hands it in. */
export const platformFetch = fetch as unknown as Fetch;

/** Where a pull request is, and the credentials to read and comment on it. */
export interface PullRequestAddress {
  readonly apiUrl: string;
  /** `owner/name`. */
  readonly repository: string;
  readonly number: number;
  readonly token: string;
}

/** The only author whose comment the Action will replace: the one `GITHUB_TOKEN` writes as. */
const ACTIONS_BOT = 'github-actions[bot]';

/** Rows per page the API is asked for, its largest. */
const PAGE = 100;

/** The pages a listing is read through before it is called too long to read. */
const MOST_PAGES = 30;

export interface GitHub {
  /** Paths of the files the pull request changes. */
  changedFiles(): Promise<string[]>;
  /** The pull request's reviews, oldest first. */
  reviews(): Promise<Review[]>;
  /**
   * Writes the one comment: replaces the one this Action wrote before, or adds it — unless
   * `onlyIfThere`, which refreshes a comment that exists and adds none.
   */
  upsertComment(body: string, onlyIfThere: boolean): Promise<'created' | 'updated' | 'left alone'>;
}

export function connect(address: PullRequestAddress, fetchIt: Fetch): GitHub {
  const base = `${address.apiUrl.replace(/\/+$/, '')}/repos/${address.repository}`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${address.token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };

  async function call(method: string, url: string, body?: unknown): Promise<unknown> {
    const response = await fetchIt(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} to ${method} ${url.replace(base, '')}`);
    }
    return response.json();
  }

  async function listed(path: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let page = 1; page <= MOST_PAGES; page += 1) {
      const got = await call('GET', `${base}${path}?per_page=${PAGE}&page=${page}`);
      if (!Array.isArray(got)) throw new Error(`GitHub did not answer a list to GET ${path}`);
      rows.push(...(got as unknown[]));
      if (got.length < PAGE) return rows;
    }
    throw new Error(
      `${path} is longer than ${MOST_PAGES * PAGE} rows; refusing to read part of it`,
    );
  }

  return {
    async changedFiles() {
      return (await listed(`/pulls/${address.number}/files`)).flatMap((row) => {
        const { filename } = row as { filename?: unknown };
        return typeof filename === 'string' ? [filename] : [];
      });
    },
    async reviews() {
      return (await listed(`/pulls/${address.number}/reviews`)).flatMap((row) => {
        const { user, state } = row as { user?: { login?: unknown } | null; state?: unknown };
        const login = user?.login;
        return typeof login === 'string' && typeof state === 'string'
          ? [{ user: login, state }]
          : [];
      });
    },
    async upsertComment(body, onlyIfThere) {
      const comments = await listed(`/issues/${address.number}/comments`);
      const mine = comments.find((row) => {
        const { body: text, user } = row as {
          body?: unknown;
          user?: { login?: unknown; type?: unknown } | null;
        };
        return (
          typeof text === 'string' &&
          text.startsWith(MARKER) &&
          user?.type === 'Bot' &&
          user.login === ACTIONS_BOT
        );
      }) as { id?: unknown } | undefined;
      if (mine !== undefined && typeof mine.id === 'number') {
        await call('PATCH', `${base}/issues/comments/${mine.id}`, { body });
        return 'updated';
      }
      if (onlyIfThere) return 'left alone';
      await call('POST', `${base}/issues/${address.number}/comments`, { body });
      return 'created';
    },
  };
}
