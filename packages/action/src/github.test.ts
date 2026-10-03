import { describe, expect, it } from 'vitest';
import { MARKER } from './comment.js';
import { connect, type Fetch } from './github.js';

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly authorization: string | undefined;
}

/** A GitHub that answers from a table keyed by `METHOD path`, recording every call. */
function fake(answers: Record<string, unknown>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchIt: Fetch = async (url, init) => {
    calls.push({
      method: init.method,
      url,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      authorization: init.headers.authorization,
    });
    const key = `${init.method} ${url.replace('https://api.test/repos/o/r', '').split('?')[0]}`;
    if (!(key in answers)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answers[key] };
  };
  return { fetch: fetchIt, calls };
}

const bot = { login: 'github-actions[bot]', type: 'Bot' };
const address = { apiUrl: 'https://api.test/', repository: 'o/r', number: 7, token: 'tok' };

describe('connect', () => {
  it('lists the changed files and the reviews, sending the token as a bearer', async () => {
    const { fetch, calls } = fake({
      'GET /pulls/7/files': [{ filename: 'a.ts' }, { filename: 'b/c.ts' }],
      'GET /pulls/7/reviews': [
        { user: { login: 'ana' }, state: 'APPROVED' },
        { user: null, state: 'COMMENTED' },
      ],
    });
    const github = connect(address, fetch);
    expect(await github.changedFiles()).toEqual(['a.ts', 'b/c.ts']);
    expect(await github.reviews()).toEqual([{ user: 'ana', state: 'APPROVED' }]);
    expect(calls.every((call) => call.authorization === 'Bearer tok')).toBe(true);
  });

  it('reads every page of a long listing', async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ filename: `f${from + i}` }));
    const pages = [page(0, 100), page(100, 5)];
    let at = 0;
    const github = connect(address, async () => ({
      ok: true,
      status: 200,
      json: async () => pages[at++],
    }));
    expect(await github.changedFiles()).toHaveLength(105);
  });

  it('adds the comment when this Action has not written one, and says so', async () => {
    const { fetch, calls } = fake({
      'GET /issues/7/comments': [{ id: 1, body: 'someone else' }],
      'POST /issues/7/comments': {},
    });
    expect(await connect(address, fetch).upsertComment(`${MARKER}\nnew`, false)).toBe('created');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });

  it('replaces the comment it wrote before instead of adding a second', async () => {
    const { fetch, calls } = fake({
      'GET /issues/7/comments': [
        { id: 1, body: 'someone else' },
        { id: 2, body: `${MARKER}\nold`, user: bot },
      ],
      'PATCH /issues/comments/2': {},
    });
    const body = `${MARKER}\nnew`;
    expect(await connect(address, fetch).upsertComment(body, false)).toBe('updated');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
    expect(calls[1]?.body).toEqual({ body });
  });

  it('never touches a comment carrying the marker that somebody else wrote', async () => {
    const { fetch, calls } = fake({
      'GET /issues/7/comments': [
        { id: 1, body: `${MARKER}\nforged`, user: { login: 'mallory', type: 'User' } },
        { id: 2, body: `${MARKER}\nforged`, user: { login: 'github-actions[bot]', type: 'User' } },
        { id: 3, body: `${MARKER}\nforged` },
      ],
      'POST /issues/7/comments': {},
    });
    expect(await connect(address, fetch).upsertComment(`${MARKER}\nnew`, false)).toBe('created');
    expect(calls.map((c) => `${c.method}`)).toEqual(['GET', 'POST']);
    const left = fake({
      'GET /issues/7/comments': [{ id: 1, body: MARKER, user: { login: 'm', type: 'User' } }],
    });
    expect(await connect(address, left.fetch).upsertComment(MARKER, true)).toBe('left alone');
  });

  it('leaves a pull request without a comment alone when asked to refresh only', async () => {
    const { fetch, calls } = fake({ 'GET /issues/7/comments': [] });
    expect(await connect(address, fetch).upsertComment(MARKER, true)).toBe('left alone');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('fails with the status, and never with the token', async () => {
    const { fetch } = fake({});
    const refused = connect(address, fetch).changedFiles();
    await expect(refused).rejects.toThrow('GitHub answered 404 to GET /pulls/7/files');
    await expect(refused).rejects.not.toThrow('tok');
  });
});
