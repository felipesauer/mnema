// @reads-the-tree
/**
 * A BROKEN LINK AFTER THE MERGE OPENS ONE ISSUE: the job that asks the network for every image and
 * every absolute link of the READMEs once the change is on `main`.
 *
 * The network and the issues are the two seams, and both are handed in here: a `fetch` that answers
 * from a table and counts its calls, and an issue book that records what was asked of it. What is
 * pinned is the behaviour a person would name: everything answers, nothing is opened; one address
 * answers 404, one issue names it; the same address answering 404 on the next push while the issue
 * is open, a comment and not a second issue; a flaky network is asked three times before it
 * counts, and no answer at all never accuses a page.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addressesIn,
  asProse,
  NOTHING_ANSWERED,
  NOTHING_ASKED,
  pagesIn,
  scanPages,
  THE_TITLE,
  tellSomebody,
} from '../../../.github/the-links-after-the-merge/check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const IMAGE = 'https://raw.githubusercontent.com/felipesauer/mnema/main/docs/assets/a.svg';
const PAGE = 'https://github.com/felipesauer/mnema/blob/main/docs/install.md';

const README = [
  `<img src="${IMAGE}" alt="a">`,
  `Read [the install page](${PAGE}#anywhere) first.`,
  '',
].join('\n');

/** A `fetch` that answers each address from `answers` (a status, or a list for each attempt). */
function network(answers: Record<string, number | 'down' | (number | 'down')[]>) {
  const calls: string[] = [];
  const ask = (async (url: string) => {
    calls.push(url);
    const seen = calls.filter((one) => one === url).length;
    const planned = answers[url] ?? 200;
    const next = Array.isArray(planned) ? (planned[seen - 1] ?? planned.at(-1)) : planned;
    if (next === 'down') throw new TypeError('fetch failed');
    return new Response(null, { status: next as number });
  }) as unknown as typeof fetch;
  return { ask, calls };
}

/** An issue book: what is open, and what was done to it. */
function issueBook() {
  const open: { number: number; title: string }[] = [];
  const done: string[] = [];
  return {
    open,
    done,
    issues: {
      findOpen: async (title: string) => open.find((one) => one.title === title)?.number ?? null,
      create: async (title: string, body: string) => {
        const number = 100 + open.length;
        open.push({ number, title });
        done.push(`create ${number}: ${body}`);
        return number;
      },
      comment: async (number: number, body: string) => {
        done.push(`comment ${number}: ${body}`);
      },
    },
  };
}

const noWait = async () => {};
const pages = [{ path: 'README.md', text: README }];

describe('what the job reads from the pages', () => {
  it('takes every image and every absolute link, once, with the line and without the anchor', () => {
    expect(addressesIn(pages[0] as { path: string; text: string })).toEqual([
      { url: PAGE, line: 2 },
      { url: IMAGE, line: 1 },
    ]);
  });

  it('leaves out an example, a code span, a fenced block and a relative link', () => {
    const text = [
      '[a](https://example.com/x) [b](http://localhost:3000/) [c](docs/a.md)',
      'A `[d](https://github.com/felipesauer/mnema/blob/main/no.md)` span.',
      '```',
      '![e](https://raw.githubusercontent.com/felipesauer/mnema/main/fenced.svg)',
      '```',
      '',
    ].join('\n');
    expect(addressesIn({ path: 'README.md', text })).toEqual([]);
  });

  it('reads the real pages of this repository, so the ruler is not empty', () => {
    const real = pagesIn(ROOT);
    expect(real.map((one) => one.path)).toEqual(
      expect.arrayContaining(['README.md', 'packages/code/README.md', 'docs/install.md']),
    );
    expect(real.every((one) => one.path.endsWith('.md'))).toBe(true);
    const urls = real.flatMap((one) => addressesIn(one)).map((one) => one.url);
    expect(urls.some((url) => url.startsWith('https://raw.githubusercontent.com/'))).toBe(true);
  });
});

describe('a broken link after the merge opens one issue', () => {
  it('opens nothing when every address answers 200', async () => {
    const { ask } = network({});
    const book = issueBook();
    const reading = await scanPages({ pages, fetch: ask, wait: noWait });
    expect(reading.verdict).toBe('clean');
    expect(await tellSomebody(reading, book.issues)).toEqual({ did: 'nothing' });
    expect(book.done).toEqual([]);
  });

  it('opens one issue that names the address that answered 404, and where it is written', async () => {
    const { ask } = network({ [IMAGE]: 404 });
    const book = issueBook();
    const reading = await scanPages({ pages, fetch: ask, wait: noWait });
    expect(reading.broken).toEqual([
      { url: IMAGE, status: 404, places: [{ file: 'README.md', line: 1 }] },
    ]);
    expect(await tellSomebody(reading, book.issues, 'https://example.test/run/1')).toEqual({
      did: 'opened',
      number: 100,
    });
    expect(book.open).toEqual([{ number: 100, title: THE_TITLE }]);
    expect(book.done).toHaveLength(1);
    expect(book.done[0]).toContain(IMAGE);
    expect(book.done[0]).toContain('HTTP 404');
    expect(book.done[0]).toContain('README.md, line 1');
    expect(book.done[0]).not.toContain(PAGE);
  });

  it('comments on the open issue when the same address answers 404 again, and opens no other', async () => {
    const { ask } = network({ [IMAGE]: 404 });
    const book = issueBook();
    const reading = await scanPages({ pages, fetch: ask, wait: noWait });
    await tellSomebody(reading, book.issues);
    expect(await tellSomebody(reading, book.issues)).toEqual({ did: 'commented', number: 100 });
    expect(book.open).toHaveLength(1);
    expect(book.done.map((one) => one.split(':')[0])).toEqual(['create 100', 'comment 100']);
  });

  it('does not count a link that answers on the third attempt', async () => {
    const { ask, calls } = network({ [PAGE]: [404, 404, 200] });
    const waits: number[] = [];
    const reading = await scanPages({
      pages,
      fetch: ask,
      wait: async (ms: number) => {
        waits.push(ms);
      },
    });
    expect(reading.verdict).toBe('clean');
    expect(calls.filter((one) => one === PAGE)).toHaveLength(3);
    expect(waits).toHaveLength(2);
  });

  it('asks a link that keeps answering 404 three times, and no more, before it counts', async () => {
    const { ask, calls } = network({ [PAGE]: 404 });
    const reading = await scanPages({ pages, fetch: ask, wait: noWait });
    expect(calls.filter((one) => one === PAGE)).toHaveLength(3);
    expect(reading.broken.map((one) => one.url)).toEqual([PAGE]);
  });

  it('treats an address with no answer in three attempts as unreachable and opens nothing', async () => {
    const { ask, calls } = network({ [PAGE]: 'down' });
    const book = issueBook();
    const reading = await scanPages({ pages, fetch: ask, wait: noWait });
    expect(calls.filter((one) => one === PAGE)).toHaveLength(3);
    expect(reading.verdict).toBe('clean');
    expect(reading.unreachable.map((one) => one.url)).toEqual([PAGE]);
    expect(asProse(reading)).toContain('could not be reached');
    expect(await tellSomebody(reading, book.issues)).toEqual({ did: 'nothing' });
    expect(book.done).toEqual([]);
  });

  it('refuses, and opens nothing, when no address answers at all', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const book = issueBook();
    const reading = await scanPages({ pages, fetch: down, wait: noWait });
    expect(reading).toMatchObject({ verdict: 'ruler-broken', code: 2, why: NOTHING_ANSWERED });
    expect(await tellSomebody(reading, book.issues)).toEqual({ did: 'nothing' });
    expect(book.done).toEqual([]);
  });

  it('refuses when the pages hold no address, instead of reporting that all answer', async () => {
    const { ask } = network({});
    const reading = await scanPages({
      pages: [{ path: 'README.md', text: 'no links here\n' }],
      fetch: ask,
      wait: noWait,
    });
    expect(reading).toMatchObject({ verdict: 'ruler-broken', code: 2, why: NOTHING_ASKED });
  });
});

describe('a page of a package on npm is asked of the registry', () => {
  const PACKAGE_PAGE = 'https://www.npmjs.com/package/@mnema/code';
  const VERSION_PAGE = 'https://www.npmjs.com/package/@mnema/code/v/2.3.4';
  const THE_PAGES = [{ path: 'README.md', text: `[a](${PACKAGE_PAGE}) [b](${VERSION_PAGE})\n` }];

  /** The npm site refuses every automated client; the registry answers for what exists. */
  function npm(exists: boolean) {
    const calls: string[] = [];
    const ask = (async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://www.npmjs.com/')) return new Response(null, { status: 403 });
      return new Response(null, { status: exists ? 200 : 404 });
    }) as unknown as typeof fetch;
    return { ask, calls };
  }

  it('counts the page of a package that exists as alive, through the registry', async () => {
    const { ask, calls } = npm(true);
    const reading = await scanPages({ pages: THE_PAGES, fetch: ask, wait: noWait });
    expect(reading.verdict).toBe('clean');
    expect(reading.broken).toEqual([]);
    expect(calls.sort()).toEqual([
      'https://registry.npmjs.org/@mnema%2fcode',
      'https://registry.npmjs.org/@mnema%2fcode/2.3.4',
    ]);
  });

  it('still counts the page of a package that does not exist as broken, under the address of the page', async () => {
    const { ask } = npm(false);
    const reading = await scanPages({ pages: THE_PAGES, fetch: ask, wait: noWait });
    expect(reading.verdict).toBe('broken');
    expect(reading.broken.map((one) => [one.url, one.status])).toEqual([
      [PACKAGE_PAGE, 404],
      [VERSION_PAGE, 404],
    ]);
  });
});

describe('the workflow that runs it', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/after-merge-links.yml'), 'utf-8');

  it('runs on a push to main and by hand, never on a pull request', () => {
    const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    expect(triggers).toContain('push:');
    expect(triggers).toContain('branches: [main]');
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toContain('pull_request');
  });

  it('writes issues in the one job that opens them, and nowhere else', () => {
    expect(workflow.match(/issues: write/g)).toHaveLength(1);
    const tell = workflow.slice(workflow.indexOf('tell-somebody:'));
    expect(tell).toContain('issues: write');
    expect(workflow).not.toMatch(/secrets\./);
  });
});
