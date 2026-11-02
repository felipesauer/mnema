// @reads-the-tree
/**
 * EVERY PAGE OF THE SITE SAYS WHAT IT IS, TO A SEARCH ENGINE TOO. A study of 29 October found that every page of
 * the site carried the same meta description (a global `head` tag of the site's configuration beat the one in each
 * page's frontmatter), that `/record/` had a title shared by every record in the world and no description or
 * canonical, and that the sitemap, written before `/record/` existed, did not list it. A page that is found by a
 * generic sentence is found for nothing, so what a page says of itself is held here:
 *
 *   - EACH BUILT PAGE HAS ONE TITLE, ONE DESCRIPTION AND ONE CANONICAL, AND NO TWO PAGES SHARE ONE of them. The
 *     canonical is the page's own address under the site's home (`homeUrl`, from the facts the site is built from).
 *   - THE SITEMAP IS THE PAGES: the canonical of every built page but the 404, `/record/` among them, once each.
 *   - THE STRUCTURED DATA IS BUILT FROM FACTS (`structuredDataOf`), is on the landing and on `/record/` and on no
 *     other page, names GitHub, npm and the two extension stores as where the software is, and carries no rating
 *     and no review on any page.
 *   - A PAGE OF `docs/` DESCRIBES ITSELF WITH ITS OWN FIRST PARAGRAPH (`descriptionOf`), read and never typed.
 *
 * The cases over the built pages need the site built (`cd site && npm ci --ignore-scripts && npm run build`, after
 * `pnpm build`); with no build they stand down by name, as the guard of the built site does, and the site workflow's
 * `THE_SITE_MUST_BE_BUILT=1` makes a missing build the failure. The cases over the functions and over the sources run
 * everywhere.
 *
 * WHAT IT DOES NOT CHECK: that a search engine shows these words, indexes the site or ranks it (nothing here asks
 * one), nor that a description is a good one: it is the page's own first paragraph, and a reader judges that.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { theFacts } from '../../../site/build/the-build.mjs';
import {
  copyOf,
  DESCRIPTION_CHARS,
  descriptionOf,
  headOfTheRecord,
  jsonLdOf,
  pageOf,
  sitemapWith,
  structuredDataOf,
} from '../../../site/build/the-pages.mjs';
import { DIST, htmlFiles, ROOT, readText, SITE, tracked } from './support/reading-the-site.js';

const BUILT = existsSync(join(DIST, 'index.html'));
const MUST = process.env.THE_SITE_MUST_BE_BUILT === '1';
const when = BUILT ? describe : describe.skip;

const FACTS = {
  name: 'r',
  description: 'The description of the package.',
  version: '1.2.3',
  license: 'Apache-2.0',
  repoUrl: 'https://github.com/o/r',
  homeUrl: 'https://o.github.io/r/',
  npmUrl: 'https://www.npmjs.com/package/@r/code',
  extensionId: 'pub.ext',
};

describe('what a page of docs/ says of itself is the first sentence of its prose, unless it says its own', () => {
  it('skips the heading, a fence, a table, a list and a line of HTML, and reads a link, bold and code as words', () => {
    const page = [
      '# Title',
      '',
      '```sh',
      'mnema x',
      '```',
      '',
      '| a | b |',
      '',
      '- an item',
      '',
      '<p>html</p>',
      '',
      'The **first** [real](x.md) paragraph, with `code`.',
      '',
      'The second.',
    ].join('\n');
    expect(descriptionOf(page, 'p.md')).toBe('The first real paragraph, with code.');
  });

  it('is the FIRST SENTENCE of the paragraph, not the paragraph', () => {
    expect(descriptionOf('# T\n\nOne sentence. And a second one.\n', 'p.md')).toBe('One sentence.');
  });

  it("is the page's own `<!-- description: ... -->` line when it has one, whatever its prose says", () => {
    const page = '# T\n\n<!-- description: Its own words. -->\n\nProse that says less. More.\n';
    expect(descriptionOf(page, 'p.md')).toBe('Its own words.');
  });

  it('cuts a first sentence that is longer than a result shows at a whole word, with an ellipsis', () => {
    const noSentence = descriptionOf(`# T\n\n${'longword '.repeat(60)}\n`, 'p.md');
    expect(noSentence.endsWith('longword…')).toBe(true);
    expect(noSentence.length).toBeLessThanOrEqual(DESCRIPTION_CHARS + 1);
  });

  it('stops when a page has no paragraph of prose to describe it', () => {
    expect(() => descriptionOf('# T\n\n- only a list\n', 'p.md')).toThrow('p.md has no paragraph');
  });

  it('is written into the frontmatter of the page as a JSON string', () => {
    const out = pageOf({
      name: 'a',
      markdown: '# A\n\nSays "this" and more.\n',
      facts: { ...FACTS, base: '/r' },
      docs: new Set(['a']),
    }) as string;
    expect(out).toContain('description: "Says \\"this\\" and more."\n');
  });
});

describe('the structured data is the facts, with where the software is found and no rating', () => {
  const data = structuredDataOf(FACTS) as { '@graph': Record<string, unknown>[] };

  it('is a WebSite and a SoftwareApplication of the home, with the version and the places it is found', () => {
    expect(data['@graph'].map((n) => n['@type'])).toEqual(['WebSite', 'SoftwareApplication']);
    expect(data['@graph'][0]).toMatchObject({ url: 'https://o.github.io/r/', name: 'r' });
    expect(data['@graph'][1]).toMatchObject({
      softwareVersion: '1.2.3',
      description: 'The description of the package.',
      license: 'https://spdx.org/licenses/Apache-2.0.html',
      sameAs: [
        'https://github.com/o/r',
        'https://www.npmjs.com/package/@r/code',
        'https://marketplace.visualstudio.com/items?itemName=pub.ext',
        'https://open-vsx.org/extension/pub/ext',
      ],
    });
  });

  it('carries no rating and no review, whatever the facts say', () => {
    expect(JSON.stringify(data)).not.toMatch(/rating|review/i);
  });

  it('escapes every < of the text, so no value closes the script it sits in', () => {
    const text = jsonLdOf({ a: '</script><b>' });
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual({ a: '</script><b>' });
  });
});

describe('the head of /record/ and the sitemap line the build adds after Astro', () => {
  it('hands mnema site --head the title and description, the canonical under the home and the structured data', () => {
    expect(headOfTheRecord({ title: 'T', description: 'D', facts: FACTS })).toEqual({
      title: 'T',
      description: 'D',
      canonical: 'https://o.github.io/r/record/',
      structuredData: structuredDataOf(FACTS),
    });
  });

  it('adds one address to the sitemap, and stops at one already there or at a file that is not a sitemap', () => {
    const xml = '<urlset><url><loc>https://o.github.io/r/</loc></url></urlset>';
    const out = sitemapWith(xml, 'https://o.github.io/r/record/') as string;
    expect(out).toBe(
      '<urlset><url><loc>https://o.github.io/r/</loc></url><url><loc>https://o.github.io/r/record/</loc></url></urlset>',
    );
    expect(() => sitemapWith(out, 'https://o.github.io/r/record/')).toThrow('already lists');
    expect(() => sitemapWith('<html></html>', 'x')).toThrow('not the shape');
  });
});

describe('the pages of this tree say different things of themselves', () => {
  const facts = theFacts();
  const names = tracked('docs/*.md').map((f) => f.slice(5, -3));
  const docs = new Set(names);
  const described = names.map((name) => {
    const out = pageOf({
      name,
      markdown: readText(join(ROOT, `docs/${name}.md`)),
      facts,
      docs,
    }) as string;
    const description = /^description: (.*)$/m.exec(out)?.[1];
    return {
      name,
      description: description === undefined ? '' : (JSON.parse(description) as string),
    };
  });

  it('gives each page of docs/ a description of its own, none longer than a result shows', () => {
    expect(described.length).toBeGreaterThan(10);
    for (const { name, description } of described) {
      expect(description.length, `${name} has no description`).toBeGreaterThan(20);
      expect(description.length, `${name}: its description is too long`).toBeLessThanOrEqual(
        DESCRIPTION_CHARS,
      );
    }
  });

  it('names the extension as the pages of the extension do: its id is the one its README publishes it under', () => {
    expect(facts.extensionId).toBe('mnema.mnema');
    expect(readText(join(ROOT, 'packages/vscode/README.md'))).toContain(`\`${facts.extensionId}\``);
  });

  it('shares no description between a page of docs/, the landing and /record/', () => {
    const copy = copyOf(readFileSync(join(SITE, 'copy.md'), 'utf8')) as Map<string, string>;
    expect(copy.get('record-title'), 'site/copy.md has no record-title').toBeTruthy();
    const all = [
      ...described.map((d) => d.description),
      facts.description,
      copy.get('record-description'),
      copy.get('not-found'),
    ];
    expect(new Set(all).size, 'two pages say the same of themselves').toBe(all.length);
  });
});

/** The address a built file is served at, under the home of the site. */
const addressOf = (file: string, home: string): string =>
  `${home}${file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '/')}`;

describe('the built site has a build to read', () => {
  it('has one, or stands down by name', () => {
    if (MUST) expect(BUILT, 'site/dist is not built, and this run says it must be').toBe(true);
    else expect(true).toBe(true);
  });
});

when('the built pages', () => {
  const facts = theFacts();
  const files = (BUILT ? htmlFiles(DIST) : []).filter((f) => !f.startsWith('pagefind/'));
  const html = (file: string): string => readText(join(DIST, file));
  /** What `<head>` of a page holds under a pattern with one capture group, every time. */
  const all = (file: string, pattern: RegExp): string[] =>
    [...html(file).matchAll(pattern)].map((m) => m[1] as string);

  it('has a title, a description and a canonical on every page, one each', () => {
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      expect(all(file, /<title>([^<]+)<\/title>/g), `${file}: titles`).toHaveLength(1);
      expect(
        all(file, /<meta name="description" content="([^"]*)"/g),
        `${file}: descriptions`,
      ).toHaveLength(1);
      expect(
        all(file, /<link rel="canonical" href="([^"]*)"/g),
        `${file}: canonicals`,
      ).toHaveLength(1);
    }
  });

  it('shares no title, no description and no canonical between two pages, and a canonical is the address of its page', () => {
    const seen = {
      title: new Map<string, string>(),
      description: new Map<string, string>(),
      canonical: new Map<string, string>(),
    };
    for (const file of files) {
      const found = {
        title: all(file, /<title>([^<]+)<\/title>/g)[0] ?? '',
        description: all(file, /<meta name="description" content="([^"]*)"/g)[0] ?? '',
        canonical: all(file, /<link rel="canonical" href="([^"]*)"/g)[0] ?? '',
      };
      for (const kind of ['title', 'description', 'canonical'] as const) {
        expect(found[kind], `${file}: ${kind} is empty`).not.toBe('');
        expect(
          seen[kind].get(found[kind]),
          `${file} says the same ${kind} as ${seen[kind].get(found[kind])}`,
        ).toBeUndefined();
        seen[kind].set(found[kind], file);
      }
      expect(found.canonical, `${file}: its canonical is not its address`).toBe(
        addressOf(file, facts.homeUrl),
      );
    }
  });

  it('lists in the sitemap every built page but the 404, /record/ among them, and nothing else', () => {
    const sitemap = readText(join(DIST, 'sitemap-0.xml'));
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string);
    const pages = files.filter((f) => f !== '404.html').map((f) => addressOf(f, facts.homeUrl));
    expect(listed).toContain(`${facts.homeUrl}record/`);
    expect([...listed].sort()).toEqual([...pages].sort());
    expect(new Set(listed).size, 'an address is listed twice').toBe(listed.length);
  });

  it('carries the structured data of structuredDataOf on the landing and on /record/ and on no other page', () => {
    const expected = structuredDataOf(facts);
    for (const file of files) {
      const blocks = all(file, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      if (file === 'index.html' || file === 'record/index.html') {
        expect(blocks, `${file}: one block of structured data`).toHaveLength(1);
        expect(JSON.parse(blocks[0] ?? ''), `${file}: not built from the facts`).toEqual(expected);
      } else {
        expect(blocks, `${file} carries structured data`).toEqual([]);
      }
    }
  });

  it('carries no rating and no review on any page', () => {
    for (const file of files) {
      expect(html(file), `${file} carries a rating`).not.toMatch(
        /aggregateRating|ratingValue|"@type":"Review"/,
      );
    }
  });
});
