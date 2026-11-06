// @reads-the-tree
/**
 * THE PAGE OF WHAT 0.1.6 IS EXPECTED TO BRING SAYS PLANS, AND CITES ONLY WHAT THE RECORD HOLDS. The page
 * (`docs/what-0-1-6-is-expected-to-bring.md`) promises nothing, and every line of it leans on a decision a stranger
 * can look up. What is held here:
 *
 *   - EVERY LINE OF A LIST CITES AT LEAST ONE DECISION, as a link to that decision on the record page, and the label in
 *     the link text is the label in the address (`[ADR-12](…/record/#ADR-12)`).
 *   - EVERY DECISION CITED IS IN THE RECORD COMMITTED AT HEAD, PUBLIC AND ACCEPTED: the public tree is taken out of the
 *     commit (never the working tree, never the private tree of whoever runs this), and the binary built here is
 *     asked to `show` each label. A label that is not there, one still proposed, or one superseded, fails by name.
 *   - NOTHING IS PROMISED: the page says "expected" and never "will", and it gives no date (no year, no month).
 *   - IT IS REACHED FROM THE FRONT PAGE'S "DOCS" (the list the site's navigation is read from, held by
 *     `the-site-is-made-of-its-sources.test.ts`), and the CHANGELOG says it was added.
 *
 * WHAT IT DOES NOT CHECK: that a plan is carried out (nothing here asks the code), nor that a line says what its
 * decision says in the same words: a reader judges that.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './support/published-examples.js';

const PAGE = 'docs/what-0-1-6-is-expected-to-bring.md';
const page = readFileSync(join(ROOT, PAGE), 'utf-8');

/** The record page's address of a decision, the one every link of the page must have. */
const RECORD_PAGE = 'https://mnema.work/record/';

/** `[ADR-n](target)`, wherever it stands. */
const CITATION = /\[(ADR-\d+)\]\(([^)\s]+)\)/g;

/** The items of the page's lists, each with the lines it continues over. */
function itemsOf(markdown: string): string[] {
  const items: string[] = [];
  for (const line of markdown.split('\n')) {
    if (line.startsWith('- ')) items.push(line);
    else if (line.startsWith('  ') && items.length > 0)
      items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/** The labels a text cites by link, in order, each with its address. */
function citationsOf(markdown: string): { label: string; target: string }[] {
  return [...markdown.matchAll(CITATION)].map((m) => ({ label: m[1] ?? '', target: m[2] ?? '' }));
}

/** A word that promises, and a year or a month that dates: what the page must not say. */
function promisesOrDates(markdown: string): string[] {
  const prose = markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/\]\([^)]*\)/g, ']');
  const found: string[] = [];
  if (/\bwill\b/i.test(prose)) found.push('will');
  if (/\b(19|20)\d\d\b/.test(prose)) found.push('a year');
  if (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      prose.replace(/\bmay\b/g, ''),
    )
  ) {
    found.push('a month');
  }
  return found;
}

describe('the page of what 0.1.6 is expected to bring', () => {
  it('is a page that says plans, with items to read', () => {
    expect(page.startsWith('# What 0.1.6 is expected to bring\n'), 'its title').toBe(true);
    expect(page).toMatch(/<!-- description: [^>]{20,} -->/);
    expect(page).toContain('plans, not promises');
    expect(itemsOf(page).length, 'RULER BROKEN: the page has no item').toBeGreaterThanOrEqual(8);
  });

  it('cites a decision on every line of every list, and the label is the address', () => {
    for (const item of itemsOf(page)) {
      const cited = citationsOf(item);
      expect(cited.length, `no decision on: ${item.slice(0, 80)}`).toBeGreaterThan(0);
      for (const { label, target } of cited) {
        expect(target, `${label} points elsewhere`).toBe(`${RECORD_PAGE}#${label}`);
      }
    }
  });

  it('says expected and never will, and gives no date', () => {
    expect(page).toContain('expected');
    expect(promisesOrDates(page)).toEqual([]);
  });

  it('is in the front page Docs, and the changelog says it', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toContain(`(${PAGE})`);
    const docs = readme.slice(readme.indexOf('\n## Docs\n'), readme.indexOf('\n## License'));
    expect(
      docs,
      'the Docs list of the front page, which the site navigation is read from',
    ).toContain(`(${PAGE})`);
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf-8');
    // The entry sits under Unreleased until the release that carries the page cuts that section,
    // and under the newest released section after it: either says it.
    const firstReleased = changelog.indexOf('\n## [0.');
    const unreleased = changelog.slice(
      changelog.indexOf('## [Unreleased]'),
      changelog.indexOf('\n## [0.', firstReleased + 1),
    );
    expect(unreleased).toContain('docs/what-0-1-6-is-expected-to-bring.md');
  });
});

describe('every decision the page cites is in the record committed at HEAD, public and accepted', () => {
  let dir = '';
  let tree = '';
  let home = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'what-0-1-6-'));
    home = join(dir, 'home');
    tree = join(dir, 'tree');
    mkdirSync(home);
    mkdirSync(tree);
    const tar = join(dir, 'record.tar');
    const archived = spawnSync('git', ['archive', '--format=tar', '-o', tar, 'HEAD', '.mnema'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    if (archived.status !== 0)
      throw new Error(`the record at HEAD could not be taken out:\n${archived.stderr}`);
    const unpacked = spawnSync('tar', ['-xf', tar, '-C', tree], { encoding: 'utf-8' });
    if (unpacked.status !== 0)
      throw new Error(`the record at HEAD could not be unpacked:\n${unpacked.stderr}`);
    const init = spawnSync('git', ['init', '-q', tree], { encoding: 'utf-8' });
    if (init.status !== 0)
      throw new Error(`a directory for the record could not be made:\n${init.stderr}`);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** What `mnema show <label>` says over the committed public tree, with a home of its own. */
  const show = (label: string): string => {
    const cli = join(ROOT, 'packages/code/dist/cli.js');
    expect(existsSync(cli), 'RULER BROKEN: the binary is not built (pnpm build)').toBe(true);
    const said = spawnSync(process.execPath, [cli, 'show', label], {
      cwd: tree,
      env: { HOME: home, PATH: process.env.PATH ?? '' },
      encoding: 'utf-8',
    });
    return said.status === 0 ? said.stdout : `REFUSED ${said.stdout}${said.stderr}`;
  };

  const labels = [...new Set(citationsOf(page).map((c) => c.label))];

  it('cites at least eight decisions', () => {
    expect(labels.length, 'RULER BROKEN: the page cites too few').toBeGreaterThanOrEqual(8);
  });

  for (const label of labels) {
    it(`${label} is there, public and accepted`, () => {
      const said = show(label);
      expect(said.startsWith('decision '), `${label}: ${said.slice(0, 200)}`).toBe(true);
      expect(said.split('\n')[0], label).toContain('public');
      const title = said.split('\n')[1] ?? '';
      expect(title.trimEnd(), `${label} is not accepted: ${title.slice(0, 120)}`).toMatch(
        /\(accepted\)$/,
      );
    });
  }
});

describe('what it would take to be accused (the planted spellings)', () => {
  it('a will is found', () => {
    expect(promisesOrDates('0.1.6 will bring it.')).toEqual(['will']);
  });

  it('a year and a month are found', () => {
    expect(promisesOrDates('Expected in November 2026.')).toEqual(['a year', 'a month']);
  });

  it('a line with no decision is found', () => {
    expect(citationsOf(itemsOf('- **A plan.** Expected soon.').join('\n'))).toEqual([]);
  });

  it('a link that points elsewhere than the record page is found', () => {
    const [one] = citationsOf('[ADR-9](https://example.com/#ADR-9)');
    expect(one?.target).not.toBe(`${RECORD_PAGE}#${one?.label}`);
  });
});
