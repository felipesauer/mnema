/**
 * THE LINKS AFTER THE MERGE: every image and every absolute link of a README, asked of the
 * network once the change is on `main`.
 *
 * WHY IT RUNS AFTER THE MERGE AND NOT BEFORE. The pages of the packages are read by people on
 * npm and on GitHub through ABSOLUTE addresses on `main`
 * (`raw.githubusercontent.com/<owner>/<repo>/main/...`, `github.com/<owner>/<repo>/blob/main/...`):
 * a registry resolves a relative link against the repository, not against the package, so the
 * pages carry the full address. An address like that answers only once the file is on `main`. On
 * a pull request it answers 404 for anything the pull request adds, so a check before the merge
 * would either refuse every new image or be switched off. The test that reads the pages inside
 * the suite reads the same links as paths in the tree, which is the half that can be proved
 * before the merge; this is the other half, and it was missing: an image has been published
 * broken.
 *
 * WHAT IT DOES. It reads the README of the repository root and the README of every package,
 * takes every http(s) destination of an inline link or image, a reference definition, an
 * autolink and an HTML `href`, `src` or `srcset` (outside fenced blocks, HTML comments and code
 * spans), asks the network for each address once, and, if one answers with an HTTP error,
 * opens an issue with the list, or comments on the one that is already open.
 *
 * WHAT IT DOES NOT DO. It does not check an anchor: the server never sees what follows the `#`,
 * so a heading that was renamed answers 200. The test that reads the pages in the suite owns
 * the anchors. And it writes nothing to the repository: the only thing it can change is an issue.
 *
 * A NETWORK FAILURE IS NOT A BROKEN LINK. Each address is asked up to three times with a wait
 * between the attempts (a file that has just been pushed can lag behind a cache). An address that
 * ends on an HTTP error is broken. An address that ends on no answer at all, or on a rate limit,
 * is UNREACHABLE: it is printed and never opens an issue, because a runner that lost its DNS
 * must not accuse the page. If nothing at all could be reached the reading is refused (exit 2)
 * for the reason the other instruments in `.github/` refuse: an instrument that checked nothing
 * reads exactly like one that found nothing.
 *
 * THERE IS NO ADDRESS WRITTEN IN THIS FILE. The pages are read, so a README that changes its
 * title, its anchors or its images changes what is asked and nothing here.
 *
 * Exit: 0 it read (broken addresses are reported through the issue, not through the exit), 2 it
 * could not tell.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The title of the one issue, stable on purpose: the next run looks for an open issue by it and
 * comments there instead of opening a second one.
 */
export const THE_TITLE = 'A link or an image on a README does not answer on main';

/** How many times an address is asked before it counts, and the wait before each retry. */
export const ATTEMPTS = 3;
export const WAITS_IN_MS = [10_000, 30_000];

/** The phrase a reading that asked nothing prints. */
export const NOTHING_ASKED =
  'no address was found in the pages, so this reading would say every link answers when what is true is that none was asked: check that the READMEs were read';

/** The phrase a reading where nothing answered at all prints. */
export const NOTHING_ANSWERED =
  'no address answered at all, which is the runner or the network and not the pages: nothing is reported as broken';

/**
 * Addresses that are examples or that only mean something on one machine. A page may carry them
 * on purpose, and no network can answer for them.
 */
const NOT_FOR_THE_NETWORK =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|example\.(com|org|net)|[^/]*\.(invalid|test|example|localhost))$/i;

/**
 * @typedef {{ path: string, text: string }} Page
 * @typedef {{ file: string, line: number }} Place
 * @typedef {{ url: string, places: Place[] }} Address
 * @typedef {{ url: string, status: number | null, places: Place[] }} Failure
 * @typedef {{
 *   verdict: 'clean' | 'broken' | 'ruler-broken',
 *   code: 0 | 2,
 *   why: string,
 *   asked: number,
 *   broken: Failure[],
 *   unreachable: Failure[],
 * }} Reading
 */

/** Text kept in place with every character but the line breaks made a space. */
const blank = (/** @type {string} */ text) => text.replace(/[^\n]/g, ' ');

/**
 * What a page renders: fenced blocks, HTML comments and code spans blanked out, so a link in
 * an example is not read as a link of the page and line numbers stay the page's.
 *
 * @param {string} markdown
 * @returns {string}
 */
function renderedOf(markdown) {
  /** @type {string | null} */
  let fence = null;
  const kept = markdown.split('\n').map((line) => {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (
        opening !== null &&
        opening[1]?.[0] === fence[0] &&
        (opening[1]?.length ?? 0) >= fence.length
      ) {
        fence = null;
      }
      return '';
    }
    if (opening !== null) {
      fence = opening[1] ?? null;
      return '';
    }
    return line;
  });
  return kept
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(`+)(?!`)(?:[^\n`]|`(?!\1)|\n(?!\s*\n))*?\1(?!`)/g, blank);
}

/**
 * Every http(s) destination a page carries, with the line it is on, the fragment dropped.
 *
 * @param {Page} page
 * @returns {{ url: string, line: number }[]}
 */
export function addressesIn(page) {
  const prose = renderedOf(page.text);
  const shapes = [
    // `[text](dest "title")` and `![alt](dest)`
    /!?\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
    // `[label]: dest`
    /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm,
    // `<https://...>`
    /<(https?:\/\/[^\s>]+)>/g,
    // `href="dest"` and `src="dest"`
    /\b(?:href|src)="([^"]+)"/g,
  ];
  /** @type {{ url: string, line: number }[]} */
  const found = [];
  /** @param {string} raw @param {number} offset */
  const keep = (raw, offset) => {
    if (!/^https?:\/\//i.test(raw)) return;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return;
    }
    if (NOT_FOR_THE_NETWORK.test(parsed.hostname)) return;
    parsed.hash = '';
    found.push({ url: parsed.href, line: prose.slice(0, offset).split('\n').length });
  };
  for (const shape of shapes) {
    for (const match of prose.matchAll(shape)) keep(match[1] ?? '', match.index);
  }
  // `srcset="a.svg 1x, b.svg 2x"`: each candidate is the first word of a comma part.
  for (const match of prose.matchAll(/\bsrcset="([^"]+)"/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      keep(part.trim().split(/\s+/)[0] ?? '', match.index);
    }
  }
  return found;
}

/**
 * The addresses of all the pages, each once, with every place it is written.
 *
 * @param {readonly Page[]} pages
 * @returns {Address[]}
 */
export function addressesOf(pages) {
  /** @type {Map<string, Place[]>} */
  const byUrl = new Map();
  for (const page of pages) {
    for (const { url, line } of addressesIn(page)) {
      const places = byUrl.get(url) ?? [];
      places.push({ file: page.path, line });
      byUrl.set(url, places);
    }
  }
  return [...byUrl].map(([url, places]) => ({ url, places }));
}

/**
 * ONE ADDRESS, asked up to `attempts` times. `status` is the last HTTP status, or `null` when the
 * last attempt got no answer at all or a rate limit: the two things that say nothing about the
 * page.
 *
 * @param {string} url
 * @param {{ fetch: typeof fetch, wait: (ms: number) => Promise<void>, attempts: number }} how
 * @returns {Promise<number | null>} the status that ended it: 200-399 for an address that
 *   answers, an HTTP error status for a broken one, null for no answer
 */
async function askOne(url, { fetch: ask, wait, attempts }) {
  /** @type {number | null} */
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(WAITS_IN_MS[attempt - 1] ?? WAITS_IN_MS.at(-1) ?? 0);
    try {
      const response = await ask(url, { method: 'GET', redirect: 'follow' });
      await response.body?.cancel();
      if (response.status < 400) return response.status;
      last = response.status === 429 ? null : response.status;
    } catch {
      last = null;
    }
  }
  return last;
}

/**
 * THE READING. `fetch` and `wait` are the seams: the real ones are the platform's and a timer,
 * the cases hand in their own.
 *
 * @param {{
 *   pages: readonly Page[],
 *   fetch: typeof fetch,
 *   wait?: (ms: number) => Promise<void>,
 *   attempts?: number,
 * }} world
 * @returns {Promise<Reading>}
 */
export async function scanPages({ pages, fetch: ask, wait = defaultWait, attempts = ATTEMPTS }) {
  const addresses = addressesOf(pages);
  if (addresses.length === 0) {
    return {
      verdict: 'ruler-broken',
      code: 2,
      why: NOTHING_ASKED,
      asked: 0,
      broken: [],
      unreachable: [],
    };
  }
  /** @type {Failure[]} */
  const broken = [];
  /** @type {Failure[]} */
  const unreachable = [];
  let answered = 0;
  const IN_PARALLEL = 8;
  for (let from = 0; from < addresses.length; from += IN_PARALLEL) {
    const chunk = addresses.slice(from, from + IN_PARALLEL);
    const statuses = await Promise.all(
      chunk.map((one) => askOne(one.url, { fetch: ask, wait, attempts })),
    );
    chunk.forEach((one, index) => {
      const status = statuses[index] ?? null;
      if (status === null) unreachable.push({ ...one, status: null });
      else if (status >= 400) broken.push({ ...one, status });
      else answered += 1;
    });
  }
  if (answered + broken.length === 0) {
    return {
      verdict: 'ruler-broken',
      code: 2,
      why: NOTHING_ANSWERED,
      asked: addresses.length,
      broken: [],
      unreachable,
    };
  }
  return {
    verdict: broken.length === 0 ? 'clean' : 'broken',
    code: 0,
    why: '',
    asked: addresses.length,
    broken,
    unreachable,
  };
}

/** @param {number} ms */
function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The reading as the page a person reads, and as the body of the issue.
 *
 * @param {Reading} reading
 * @returns {string}
 */
export function asProse(reading) {
  if (reading.verdict === 'ruler-broken') return `RULER BROKEN: ${reading.why}.`;
  const lines = [
    reading.broken.length === 0
      ? `EVERY ADDRESS ANSWERS: ${reading.asked} asked.`
      : `${reading.broken.length} of ${reading.asked} addresses answer with an HTTP error:`,
    '',
  ];
  for (const one of reading.broken) {
    lines.push(`- ${one.url} (HTTP ${one.status})`);
    for (const place of one.places) lines.push(`  - ${place.file}, line ${place.line}`);
  }
  if (reading.unreachable.length > 0) {
    lines.push(
      '',
      `${reading.unreachable.length} could not be reached and are not counted as broken:`,
    );
    for (const one of reading.unreachable) lines.push(`- ${one.url}`);
  }
  return lines.join('\n');
}

/**
 * THE PAGES: the README of the root and the README of every package, read from `root`.
 *
 * @param {string} root
 * @returns {Page[]}
 */
export function pagesIn(root) {
  const names = ['README.md'];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory()) names.push(`packages/${entry.name}/README.md`);
  }
  /** @type {Page[]} */
  const pages = [];
  for (const path of names) {
    try {
      pages.push({ path, text: readFileSync(join(root, path), 'utf-8') });
    } catch {
      // a package without a page has no addresses to ask
    }
  }
  return pages;
}

/**
 * THE ISSUES, as this job sees them. `findOpen` answers the number of an OPEN issue whose title
 * is exactly the one given, or null. The real one asks GitHub; the cases hand in their own.
 *
 * @typedef {{
 *   findOpen: (title: string) => Promise<number | null>,
 *   create: (title: string, body: string) => Promise<number>,
 *   comment: (number: number, body: string) => Promise<void>,
 * }} Issues
 */

/**
 * SPEAK, OR SAY NOTHING. A reading with nothing broken opens nothing and comments nothing. One
 * with something broken comments on the issue that is open under the stable title, or, if there
 * is none, opens it: one issue at a time, however many pushes find the same page broken.
 *
 * @param {Reading} reading
 * @param {Issues} issues
 * @param {string} [run] the address of the run, for whoever reads the issue
 * @returns {Promise<{ did: 'nothing' } | { did: 'opened' | 'commented', number: number }>}
 */
export async function tellSomebody(reading, issues, run = '') {
  if (reading.verdict !== 'broken') return { did: 'nothing' };
  const body = [
    asProse(reading),
    '',
    'These are the addresses the READMEs carry as the page of the package on npm and the page on GitHub show them. A file that moved, a name that changed or an image that was never pushed leaves one answering with an error.',
    ...(run === '' ? [] : ['', `Run: ${run}`]),
  ].join('\n');
  const open = await issues.findOpen(THE_TITLE);
  if (open !== null) {
    await issues.comment(open, body);
    return { did: 'commented', number: open };
  }
  return { did: 'opened', number: await issues.create(THE_TITLE, body) };
}

/**
 * THE REAL ISSUES, through `gh`, with arguments and never a shell: nothing here is interpolated
 * into a command line. `gh issue list --search` is fuzzy, so the title is compared exactly here.
 *
 * @param {string} repository `<owner>/<repo>`
 * @returns {Issues}
 */
export function issuesOf(repository) {
  /** @param {string[]} args */
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf-8' });
  return {
    async findOpen(title) {
      const listed = JSON.parse(
        gh([
          'issue',
          'list',
          '--repo',
          repository,
          '--state',
          'open',
          '--limit',
          '100',
          '--search',
          `in:title "${title}"`,
          '--json',
          'number,title',
        ]),
      );
      const same = listed.find((/** @type {{ title: string }} */ one) => one.title === title);
      return same === undefined ? null : same.number;
    },
    async create(title, body) {
      const made = gh(['issue', 'create', '--repo', repository, '--title', title, '--body', body]);
      return Number(made.trim().split('/').at(-1));
    },
    async comment(number, body) {
      gh(['issue', 'comment', String(number), '--repo', repository, '--body', body]);
    },
  };
}

/**
 * The instrument from the command line.
 *
 *   check.mjs scan [--out reading.json]   read the pages, print, and write the reading
 *   check.mjs tell reading.json           open or comment, from a reading that scan wrote
 *
 * @param {readonly string[]} argv
 * @returns {Promise<0 | 2>}
 */
export async function main(argv = process.argv.slice(2)) {
  const [verb, argument] = argv;
  if (verb === 'scan') {
    const reading = await scanPages({
      pages: pagesIn(process.cwd()),
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }),
    });
    process.stdout.write(`${asProse(reading)}\n`);
    const at = argv.indexOf('--out');
    if (at !== -1 && argv[at + 1] !== undefined) {
      writeFileSync(argv[at + 1] ?? '', `${JSON.stringify(reading, null, 2)}\n`);
    }
    return reading.code;
  }
  if (verb === 'tell' && argument !== undefined) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (repository === undefined || repository === '') {
      process.stderr.write('GITHUB_REPOSITORY is not set, so there is no repository to tell.\n');
      return 2;
    }
    const server = process.env.GITHUB_SERVER_URL;
    const runId = process.env.GITHUB_RUN_ID;
    const run =
      server !== undefined && runId !== undefined
        ? `${server}/${repository}/actions/runs/${runId}`
        : '';
    const done = await tellSomebody(
      JSON.parse(readFileSync(argument, 'utf-8')),
      issuesOf(repository),
      run,
    );
    process.stdout.write(`${done.did}${'number' in done ? ` #${done.number}` : ''}\n`);
    return 0;
  }
  process.stderr.write('usage: check.mjs scan [--out file] | check.mjs tell file\n');
  return 2;
}

if (process.argv[1]?.endsWith('the-links-after-the-merge/check.mjs')) {
  process.exit(await main());
}
