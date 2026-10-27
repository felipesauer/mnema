// @reads-the-tree
/**
 * THE SITE IS MADE OF ITS SOURCES, AND OF NOTHING ELSE. The site (`site/`) renders the pages of `docs/` and
 * the README; every sentence, colour and picture on it is read from a file the repository already holds.
 * The page of the verifier is not written for the site at all: it is what `mnema site` writes of the
 * committed record. This file holds the half of that which needs no browser and no Astro: the readings
 * (`site/build/the-pages.mjs`) over a fixture and over the real tree, what the build writes under `site/`,
 * and that /record/ cannot be made from a record that does not verify. The half that reads the HTML the
 * build wrote is `the-built-site-lands-and-says-what-it-was-built-from.test.ts`.
 *
 *   - A PAGE OF `docs/` REACHES THE SITE WITH TWO CHANGES AND NO THIRD: its title moves to the frontmatter,
 *     and each relative link lands where it should (a page of `docs/` on the site, anything else on GitHub
 *     at the commit the site was built from). Nothing is rewritten inside code.
 *   - WHAT IS TRUE OF THE NEXT VERSION AND NOT OF THE PUBLISHED ONE STAYS OFF THE SITE: a stretch the source
 *     wraps in `not-on-the-site` markers is taken out, only that stretch, and a marker that does not pair
 *     stops the build. The sentence "These pages describe the next version" is in no page the build writes.
 *   - EVERY PAGE OF `docs/` IS A PAGE OF THE SITE, and the site has no page of `docs/` that is not a file.
 *   - A LINK THE BUILD WROTE POINTS AT A FILE GIT HOLDS, or at a page the build wrote.
 *   - THE LANDING IS A TRACKED MARKDOWN FILE, so the guards that read every page of the repository reach
 *     it, and each directive in it is a source the build can read.
 *   - NO COLOUR AND NO PICTURE IS WRITTEN IN `site/`: the accent is read from `accent.mjs`, the pictures
 *     from `docs/assets/`, the icon from `packages/vscode/build/icon.mjs`.
 *   - /RECORD/ IS NOT WRITTEN FROM A RECORD THAT DOES NOT VERIFY: the build stops, and writes nothing.
 *
 * WHAT IT DOES NOT CHECK: how the pages look. A reviewer sees them in the pull request's preview.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepare } from '../../../site/build/the-build.mjs';
import {
  llmsTxt,
  pageOf,
  recordBackLink,
  rewriteLinks,
  titleOf,
  whereItLands,
  withoutWhatIsNotOnTheSite,
} from '../../../site/build/the-pages.mjs';
import { writeTheRecord } from '../../../site/build/the-record.mjs';
import { head, ROOT, SITE, tracked } from './support/reading-the-site.js';

const FACTS = {
  repoUrl: 'https://github.com/o/r',
  base: '/r',
  sha: 'abc123',
  owner: 'o',
  name: 'r',
  description: 'd',
  version: '1.0.0',
};
const DOCS = new Set(['install', 'first-record']);

describe('a page of docs/ reaches the site with its title moved and its links landed, and nothing else changed', () => {
  const page = [
    '# Install',
    '',
    'See [first record](first-record.md#the-record) and [the format](../packages/chain/FORMAT.md#1-x).',
    '',
    '```sh',
    'echo "[not a link](../packages/x.md)"',
    '```',
    '',
    'Inline `[kept](../a.md)` stays, and [absolute](https://example.com/x.md) stays.',
    '',
  ].join('\n');

  it('takes the title from the first heading outside code, into the frontmatter', () => {
    const out = pageOf({ name: 'install', markdown: page, facts: FACTS, docs: DOCS }) as string;
    expect(out.startsWith('---\ntitle: "Install"\n')).toBe(true);
    expect(out).not.toMatch(/^# Install$/m);
    expect(titleOf('```\n# not a title\n```\n\n# A title\n')).toBe('A title');
  });

  it('sends a page of docs/ to the site and anything else to the file at the commit', () => {
    const out = pageOf({ name: 'install', markdown: page, facts: FACTS, docs: DOCS }) as string;
    expect(out).toContain('[first record](/r/docs/first-record/#the-record)');
    expect(out).toContain(
      '[the format](https://github.com/o/r/blob/abc123/packages/chain/FORMAT.md#1-x)',
    );
  });

  it('leaves code and absolute links as they were', () => {
    const out = pageOf({ name: 'install', markdown: page, facts: FACTS, docs: DOCS }) as string;
    expect(out).toContain('echo "[not a link](../packages/x.md)"');
    expect(out).toContain('`[kept](../a.md)`');
    expect(out).toContain('[absolute](https://example.com/x.md)');
  });

  it('keeps a directory a directory, and refuses a link that leaves the repository', () => {
    expect(whereItLands('../packages/action/', 'docs/site.md', FACTS, DOCS)).toBe(
      'https://github.com/o/r/blob/abc123/packages/action/',
    );
    expect(() => whereItLands('../../x.md', 'docs/site.md', FACTS, DOCS)).toThrow(
      /leaves the repository/,
    );
    expect(rewriteLinks('[a](#here)', 'docs/x.md', FACTS, DOCS)).toBe('[a](#here)');
  });
});

describe('a stretch marked not-on-the-site is taken out, and only that stretch', () => {
  const OPEN = '<!-- not-on-the-site -->';
  const CLOSE = '<!-- /not-on-the-site -->';

  it('removes the lines between the markers and the markers, and nothing else', () => {
    const source = ['# T', '', 'kept one', OPEN, 'gone', 'gone too', CLOSE, 'kept two', ''].join(
      '\n',
    );
    expect(withoutWhatIsNotOnTheSite(source, 'x.md')).toBe(
      ['# T', '', 'kept one', 'kept two', ''].join('\n'),
    );
    expect(withoutWhatIsNotOnTheSite('no marker\n', 'x.md')).toBe('no marker\n');
    const twice = [OPEN, 'a', CLOSE, 'b', OPEN, 'c', CLOSE].join('\n');
    expect(withoutWhatIsNotOnTheSite(twice, 'x.md')).toBe('b');
  });

  it.each([
    ['one never closed', ['a', OPEN, 'b'].join('\n'), /x\.md:2: .*never closed/],
    ['a close with no open', ['a', CLOSE].join('\n'), /x\.md:2: .*closes what was not opened/],
    ['one inside another', [OPEN, OPEN, CLOSE].join('\n'), /x\.md:2: .*opens inside/],
    ['a marker after other text', `text ${OPEN}\nb\n${CLOSE}`, /x\.md:1: .*alone on its line/],
    ['a marker spelled with extra text', '<!-- not-on-the-site because -->', /alone on its line/],
  ])('stops the build on %s', (_name, source, message) => {
    expect(() => withoutWhatIsNotOnTheSite(source, 'x.md')).toThrow(message);
  });

  it('reaches pageOf: the page keeps the rest byte for byte', () => {
    const markdown = [
      '# Install',
      '',
      'before',
      '',
      OPEN,
      'These pages describe the next version.',
      CLOSE,
      '',
      'after',
      '',
    ].join('\n');
    const marked = pageOf({ name: 'install', markdown, facts: FACTS, docs: DOCS }) as string;
    const bare = pageOf({
      name: 'install',
      markdown: '# Install\n\nbefore\n\n\nafter\n',
      facts: FACTS,
      docs: DOCS,
    });
    expect(marked).toBe(bare);
    expect(marked).not.toContain('describe the next version');
    expect(() =>
      pageOf({ name: 'install', markdown: `# I\n${OPEN}\nx\n`, facts: FACTS, docs: DOCS }),
    ).toThrow(/never closed/);
  });

  it('wraps, in the real tree, every place the pages say they describe the next version', () => {
    const marked = tracked('README.md', 'docs/*.md').filter((f) =>
      /not-on-the-site/.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    expect(marked.sort()).toEqual(['README.md', 'docs/install.md']);
    for (const file of tracked('README.md', 'docs/*.md')) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const kept = withoutWhatIsNotOnTheSite(text, file) as string;
      expect(kept, `${file} says it on the site`).not.toMatch(/describe the next version/i);
      if (marked.includes(file))
        expect(text, `${file} loses it on GitHub`).toMatch(/describe the next version/);
    }
  });
});

describe('the pages the build writes for this tree', () => {
  let site = '';
  let facts: { sha: string; base: string; repoUrl: string };

  beforeAll(async () => {
    site = mkdtempSync(join(tmpdir(), 'the-site-'));
    cpSync(join(SITE, 'landing.md'), join(site, 'landing.md'));
    facts = await prepare({ root: ROOT, site });
  }, 60_000);
  afterAll(() => rmSync(site, { recursive: true, force: true }));

  const docsFiles = (): string[] => tracked('docs/*.md').map((f) => f.slice(5));
  const written = (): string[] => readdirSync(join(site, 'src/content/docs/docs')).sort();
  const read = (path: string): string => readFileSync(join(site, path), 'utf8');

  it('are the pages of docs/: one for each file git holds, and none besides', () => {
    expect(docsFiles().length).toBeGreaterThan(10);
    expect(written()).toEqual(docsFiles());
  });

  it('do not say they describe the next version, and are otherwise the pages of the source with only the marked stretch gone', () => {
    const stretches = /^<!-- not-on-the-site -->\n[\s\S]*?^<!-- \/not-on-the-site -->\n/gm;
    let taken = 0;
    for (const file of docsFiles()) {
      const source = readFileSync(join(ROOT, 'docs', file), 'utf8');
      const page = read(`src/content/docs/docs/${file}`);
      expect(page, `${file} says it on the site`).not.toMatch(/describe the next version/i);
      taken += (source.match(stretches) ?? []).length;
      const byHand = pageOf({
        name: file.slice(0, -3),
        markdown: source.replace(stretches, ''),
        facts,
        docs: new Set(docsFiles().map((f) => f.slice(0, -3))),
      });
      expect(page, `${file} lost more than the marked stretch`).toBe(byHand);
    }
    expect(taken, 'a page of docs/ is marked').toBeGreaterThan(0);
    expect(read('src/content/docs/index.md')).not.toMatch(/describe the next version/i);
  });

  it('are built from the commit the tree is at', () => {
    expect(facts.sha).toBe(head());
  });

  it('carry no relative link of the kind that 404s on a site, outside code', () => {
    for (const file of written()) {
      const prose = read(`src/content/docs/docs/${file}`)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '');
      const relative = [...prose.matchAll(/\]\(((?!https?:|#|\/)[^)\s]+)\)/g)].map((m) => m[1]);
      expect(relative, `${file} keeps a relative link`).toEqual([]);
    }
  });

  it('point every link to GitHub at a file or a directory of this commit, and every link to the site at a page it holds', () => {
    const files = tracked();
    const names = new Set(docsFiles().map((f) => f.slice(0, -3)));
    const seen = { github: 0, site: 0 };
    const pages = [
      ...written().map((f) => `src/content/docs/docs/${f}`),
      'src/content/docs/index.md',
    ];
    for (const page of pages) {
      const prose = read(page)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '');
      for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1] as string;
        const blob = `${facts.repoUrl}/blob/${facts.sha}/`;
        if (target.startsWith(blob)) {
          seen.github++;
          const path = target.slice(blob.length).split('#')[0] as string;
          const held =
            files.includes(path) || (path.endsWith('/') && files.some((f) => f.startsWith(path)));
          expect(held, `${page} links ${path}, which git does not hold`).toBe(true);
        } else if (target.startsWith(`${facts.base}/docs/`)) {
          seen.site++;
          expect(
            names.has(target.slice(`${facts.base}/docs/`.length).split('/')[0] as string),
            `${page}: ${target}`,
          ).toBe(true);
        } else if (target.startsWith(`${facts.base}/assets/`)) {
          expect(
            existsSync(
              join(
                ROOT,
                'docs/assets',
                target.slice(`${facts.base}/assets/`.length).split('#')[0] as string,
              ),
            ),
          ).toBe(true);
        }
      }
    }
    expect(seen.github, 'the sweep found the links to GitHub').toBeGreaterThan(150);
    expect(seen.site, 'the sweep found the links between pages').toBeGreaterThan(40);
  });

  it('make a landing out of the README: every directive of the template is a source, none is left', () => {
    const landing = read('src/content/docs/index.md');
    expect(landing).not.toMatch(/\{\{/);
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const heading of [
      ...readFileSync(join(SITE, 'landing.md'), 'utf8').matchAll(/\{\{section ([^}]+)\}\}/g),
    ].map((m) => m[1])) {
      expect(readme, `the README has no section "${heading}"`).toContain(`## ${heading}\n`);
      expect(landing).toContain(`## ${heading}\n`);
    }
    expect(landing).toContain('template: splash');
  });

  it('write llms.txt with a link to the raw page of each Markdown file the README lists', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const text = llmsTxt({ readme, facts }) as string;
    const files = tracked();
    const raw = [
      ...text.matchAll(
        /\]\(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([0-9a-f]{40})\/([^)]+)\)/g,
      ),
    ];
    expect(raw.length).toBeGreaterThan(15);
    for (const [, sha, path] of raw) {
      expect(sha).toBe(facts.sha);
      expect(files, `llms.txt names ${path}`).toContain(path);
    }
  });
});

describe('what is tracked under site/', () => {
  const files = tracked('site/').filter((f) => !f.endsWith('package-lock.json'));

  it('is found at all, and holds the landing as a Markdown file that git lists', () => {
    expect(files).toContain('site/landing.md');
    expect(tracked('*.md')).toContain('site/landing.md');
  });

  it('writes no colour and draws no picture: both are read from the files that own them', () => {
    const colour =
      /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(|<svg\b|data:image/;
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(colour.test(text), `${file} writes a colour or a picture`).toBe(false);
    }
  });
});

describe('/record/ is written from a record that verifies, or not at all', () => {
  const binary = join(ROOT, 'packages/code/dist/cli.js');
  const out = mkdtempSync(join(tmpdir(), 'the-record-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('is written for this repository: the page is what `mnema site` writes', () => {
    expect(existsSync(binary), 'build the packages first (pnpm build)').toBe(true);
    const said = writeTheRecord({
      root: ROOT,
      out: join(out, 'ok'),
      backLink: recordBackLink(FACTS),
    }) as string;
    expect(said).toMatch(/Wrote .*index\.html/);
    const page = readFileSync(join(out, 'ok', 'index.html'), 'utf8');
    expect(page).toContain('<html');
    expect(page).toContain('<p><a href="/r/">Back</a></p>');
  }, 60_000);

  it('stops when one byte of the record was changed, and writes no page', () => {
    const copy = join(out, 'copy');
    mkdirSync(copy);
    execFileSync('git', ['init', '-q', copy]);
    cpSync(join(ROOT, '.mnema'), join(copy, '.mnema'), { recursive: true });
    const tails = join(copy, '.mnema', 'tails');
    const tail = readdirSync(tails)
      .map((d) => join(tails, d, '000001.jsonl'))
      .find(existsSync) as string;
    const text = readFileSync(tail, 'utf8');
    const at = text.indexOf('"title":"') + '"title":"'.length;
    expect(at).toBeGreaterThan('"title":"'.length);
    writeFileSync(tail, text.slice(0, at) + (text[at] === 'Z' ? 'Y' : 'Z') + text.slice(at + 1));
    expect(() => writeTheRecord({ root: ROOT, cwd: copy, out: join(out, 'refused') })).toThrow(
      /does not verify/,
    );
    expect(existsSync(join(out, 'refused', 'index.html'))).toBe(false);
  }, 60_000);
});
