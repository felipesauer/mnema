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
 *   - NO COLOUR AND NO PICTURE IS WRITTEN IN `site/`: the theme is calculated from `ACCENT` (`accent.mjs`)
 *     and `PAGE` (`draw.mjs`), the pictures are read from `docs/assets/`, the icon from
 *     `packages/vscode/build/icon.mjs`.
 *   - THE THEME READS AT WCAG AA: the accent as text on the ground and on every ground Starlight maps to a
 *     grey, the text over the accent, the body and the muted text, in both themes, by a ratio written in
 *     the test and not imported from the build.
 *   - /RECORD/ IS NOT WRITTEN FROM A RECORD THAT DOES NOT VERIFY: the build stops, and writes nothing.
 *
 * WHAT IT DOES NOT CHECK: how the pages look. A reviewer sees them in the pull request's preview.
 */

import { execFileSync, spawnSync } from 'node:child_process';
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
import { prepare, RECORDING } from '../../../site/build/the-build.mjs';
import {
  cardsOf,
  copyOf,
  groupsOf,
  installLineOf,
  llmsTxt,
  pageOf,
  pitchOf,
  recordBackLink,
  recordingOf,
  rewriteLinks,
  sidebarOf,
  stepsOf,
  templateOf,
  textAccent,
  themeCss,
  themeOf,
  titleOf,
  verifyCommandOf,
  whereItLands,
  withoutWhatIsNotOnTheSite,
} from '../../../site/build/the-pages.mjs';
import { theVerdictOfTheCommit, writeTheRecord } from '../../../site/build/the-record.mjs';
import { THE_BLOCKS } from '../src/presentation/banner.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
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

  it('sends a recording a page shows to the GIF the site carries, and its script to the file at the commit', () => {
    // A GIF on GitHub's blob path is an HTML page: as an image it would be broken on the site.
    expect(whereItLands('../recordings/a-tamper-caught.gif', 'docs/what-it-proves.md', FACTS, DOCS)).toBe(
      '/r/recordings/a-tamper-caught.gif',
    );
    expect(whereItLands('../recordings/a-tamper-caught.sh', 'docs/what-it-proves.md', FACTS, DOCS)).toBe(
      'https://github.com/o/r/blob/abc123/recordings/a-tamper-caught.sh',
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

  it('keeps the README marker lines inside their list item, so the list is one list on GitHub and npm', () => {
    const lines = readFileSync(join(ROOT, 'README.md'), 'utf8').split('\n');
    const markers = lines.filter((l) => /not-on-the-site/.test(l));
    expect(markers.length).toBeGreaterThan(1);
    for (const line of markers)
      expect(line, 'a column 0 marker splits the list').toMatch(/^ {2}<!--/);
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
    for (const file of ['landing.md', 'not-found.md', 'copy.md'])
      cpSync(join(SITE, file), join(site, file));
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
          expect(path, `${page} links an image on GitHub's page, not the site's copy`).not.toMatch(
            /^recordings\/[^/]+\.gif$/,
          );
        } else if (target.startsWith(`${facts.base}/docs/`)) {
          seen.site++;
          expect(
            names.has(target.slice(`${facts.base}/docs/`.length).split('/')[0] as string),
            `${page}: ${target}`,
          ).toBe(true);
        } else if (target.startsWith(`${facts.base}/recordings/`)) {
          const gif = target.slice(`${facts.base}/recordings/`.length).split('#')[0] as string;
          expect(existsSync(join(ROOT, 'recordings', gif)), `${page}: ${target}`).toBe(true);
          expect(existsSync(join(site, 'public/recordings', gif)), `the site carries ${gif}`).toBe(
            true,
          );
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

  it('make a 404 out of its template: each action is a source and leads into the site, and the record page is the last', () => {
    const page = read('src/content/docs/404.md');
    expect(page).not.toMatch(/\{\{/);
    expect(page).toContain('template: splash');
    const copy = copyOf(readFileSync(join(SITE, 'copy.md'), 'utf8')) as Map<string, string>;
    expect(page).toContain(`title: ${JSON.stringify(copy.get('not-found-title'))}`);
    expect(page).toContain(`tagline: ${JSON.stringify(copy.get('not-found'))}`);
    const actions = [...page.matchAll(/- text: ("[^"]*")\n\s+link: ("[^"]*")/g)].map((m) => [
      JSON.parse(m[1] ?? '""') as string,
      JSON.parse(m[2] ?? '""') as string,
    ]);
    expect(actions).toEqual([
      ['Install', `${facts.base}/docs/install/`],
      ['How each claim is held', `${facts.base}/docs/evidence/`],
      ['The page that verifies itself', `${facts.base}/docs/site/`],
      [copy.get('record'), `${facts.base}/record/`],
    ]);
  });

  it('take every entry of site/copy.md, and the file holds none that nothing takes', () => {
    const proof = JSON.parse(read('src/generated/proof.json')) as { copyTaken: string[] };
    const keys = [
      ...(copyOf(readFileSync(join(SITE, 'copy.md'), 'utf8')) as Map<string, string>).keys(),
    ];
    expect(keys.length).toBeGreaterThan(0);
    expect(proof.copyTaken, 'an entry of site/copy.md that no page takes is an orphan').toEqual(
      keys.sort(),
    );
  });

  it('write the proof: the command of the Quick start, the verdict at this commit, and the recording as it is', () => {
    const proof = JSON.parse(read('src/generated/proof.json')) as {
      command: string;
      output: string;
      sha: string;
      recording: { src: string; alt: string; width: number; height: number };
    };
    expect(proof.sha).toBe(facts.sha);
    expect(proof.command).toBe('mnema verify');
    expect(proof.output).toMatch(/^public: /);
    expect(proof.output).not.toMatch(/^private:/m);
    expect(proof.recording.src).toBe(`${facts.base}/${RECORDING}`);
    const gif = readFileSync(join(ROOT, RECORDING));
    expect(proof.recording).toMatchObject({
      width: gif.readUInt16LE(6),
      height: gif.readUInt16LE(8),
    });
    expect(readFileSync(join(site, 'public', RECORDING)).equals(gif)).toBe(true);
    // Every recording of the repository is carried, because a page of docs/ may show any of them.
    for (const file of readdirSync(join(ROOT, 'recordings')).filter((f) => f.endsWith('.gif'))) {
      expect(
        readFileSync(join(site, 'public/recordings', file)).equals(
          readFileSync(join(ROOT, 'recordings', file)),
        ),
        `${file} is carried as it is`,
      ).toBe(true);
    }
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

/** WCAG 2 contrast, written here on purpose: a mistake in the build's own formula must not pass its own test. */
function wcag(one: string, other: string): number {
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(one), lum(other)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the theme the build writes reads at WCAG AA in both themes', () => {
  type Colours = Record<string, string>;
  const colours = async (): Promise<{ dark: Colours; light: Colours; css: string }> => {
    const { ACCENT } = await import('../../../.github/the-front-page/accent.mjs');
    const { PAGE } = await import('../../../.github/the-front-page/draw.mjs');
    const theme = themeOf({ ACCENT, PAGE }) as { dark: Colours; light: Colours };
    return { ...theme, css: themeCss({ ACCENT, PAGE }) as string };
  };

  it('measures contrast as the standard does: the two values the standard gives for the accent', () => {
    expect(wcag('#997dbf', '#ffffff').toFixed(2)).toBe('3.48');
    expect(wcag('#0d1117', '#997dbf').toFixed(2)).toBe('5.44');
  });

  it('makes the accent as text read at 4.5:1 on the ground and on every ground Starlight maps to a grey', async () => {
    const t = await colours();
    for (const theme of ['dark', 'light'] as const) {
      const c = t[theme];
      for (const ground of ['black', 'bg-nav', 'bg-sidebar', 'bg-inline-code'] as const) {
        const ratio = wcag(c['text-accent'] as string, c[ground] as string);
        expect(ratio, `${theme}: accent text on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const name of ['accent-high', 'text-accent']) {
        expect(c[name], `${theme}: ${name} is the colour of accent text`).toBe(c['text-accent']);
      }
    }
  });

  it('makes the text drawn over the accent read at 4.5:1: the primary button and the current item of the sidebar', async () => {
    const t = await colours();
    for (const theme of ['dark', 'light'] as const) {
      const c = t[theme];
      // Starlight draws the button in `--sl-color-black`, and the sidebar's current item in `--sl-color-text-invert`:
      // `--sl-color-accent-low` in the dark theme and `--sl-color-black` in the light one.
      for (const ink of ['black', theme === 'dark' ? 'accent-low' : 'black'] as const) {
        expect(
          wcag(c[ink] as string, c['text-accent'] as string),
          `${theme}: ${ink} over the accent`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('makes the body text and the muted text (the footer) read at 4.5:1 on the ground', async () => {
    const t = await colours();
    for (const theme of ['dark', 'light'] as const) {
      const c = t[theme];
      for (const grey of ['gray-2', 'gray-3']) {
        expect(
          wcag(c[grey] as string, c['black'] as string),
          `${theme}: ${grey} on the ground`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('takes the smallest mix of the other ground that passes, and stops the build when none does', async () => {
    const t = await colours();
    const { ACCENT } = await import('../../../.github/the-front-page/accent.mjs');
    const { PAGE } = await import('../../../.github/the-front-page/draw.mjs');
    expect(t.dark['text-accent'], 'the dark accent already passes, so it is not touched').toBe(
      ACCENT.dark,
    );
    expect(t.light['text-accent'], 'the light accent had to be darkened').not.toBe(ACCENT.light);
    const grounds = ['black', 'bg-nav', 'bg-sidebar', 'bg-inline-code'].map(
      (n) => t.light[n] as string,
    );
    const mixed = (percent: number): string => {
      const [a, b] = [ACCENT.light, PAGE.dark].map((h: string) =>
        [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)),
      ) as [number[], number[]];
      return `#${a
        .map((c, i) =>
          Math.round(c + ((b[i] as number) - c) * (percent / 100))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`;
    };
    const found = [...Array(101).keys()].find((p) => mixed(p) === t.light['text-accent']);
    expect(
      found,
      'the light accent text is a whole percent of the way to the dark ground',
    ).toBeDefined();
    const below = mixed((found as number) - 1);
    expect(
      grounds.some((g) => wcag(below, g) < 4.5),
      'one percent less would already have passed everywhere',
    ).toBe(true);
    expect(() =>
      textAccent({ ink: '#ffffff', toward: '#ffffff', grounds: ['#ffffff'], floor: 4.5 }),
    ).toThrow(/reads at 4.5:1/);
  });

  it('writes what it measured: every value is in the rule of its theme, and the accent opens each rule', async () => {
    const t = await colours();
    const rules = {
      dark: /^:root \{\n([\s\S]*?)\n\}/m.exec(t.css)?.[1],
      light: /^:root\[data-theme='light'\] \{\n([\s\S]*?)\n\}/m.exec(t.css)?.[1],
    };
    for (const theme of ['dark', 'light'] as const) {
      const rule = rules[theme] as string;
      expect(rule, `${theme}: the rule is in the file`).toBeDefined();
      expect(rule.startsWith(`  --sl-color-accent: ${t[theme]['accent']};`)).toBe(true);
      expect(Object.keys(t[theme]).length, `${theme}: the whole theme`).toBe(16);
      for (const [name, value] of Object.entries(t[theme])) {
        expect(rule, `${theme}: ${name}`).toContain(`  --sl-color-${name}: ${value};`);
      }
    }
  });
});

describe('what the landing reads of the README to show the proof', () => {
  const real = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const quick = (...lines: string[]): string =>
    ['## Quick start', '', '```sh', ...lines, '```', '', '## Next', ''].join('\n');

  it('takes the command of the one line of the Quick start that starts with `mnema verify`, up to the `#`', () => {
    expect(verifyCommandOf(quick('mnema init', 'mnema verify   # reads it, and says so'))).toBe(
      'mnema verify',
    );
    expect(verifyCommandOf(quick('mnema verify'))).toBe('mnema verify');
    expect(verifyCommandOf(real)).toBe('mnema verify');
  });

  it('stops when the Quick start has no such line, or two', () => {
    expect(() => verifyCommandOf(quick('mnema init'))).toThrow(/mnema verify/);
    expect(() => verifyCommandOf(quick('mnema verify', 'mnema verify --json'))).toThrow(
      /mnema verify/,
    );
  });

  const cell = (src: string, alt: string, sub: string): string =>
    `<td><img src="${src}" alt="${alt}"><br><sub>${sub}</sub></td>`;

  it('takes the words of the README for a recording: its alt and its caption, the links landed', () => {
    const readme = [
      cell('recordings/one.gif', 'Alt one', 'Caption one.'),
      cell(
        'recordings/two.gif',
        'Alt two',
        'Caption <code>two</code> by <a href="recordings/two.sh"><code>two.sh</code></a>.',
      ),
    ].join('\n');
    const got = recordingOf({ readme, path: 'recordings/two.gif', facts: FACTS, docs: DOCS }) as {
      alt: string;
      caption: string;
    };
    expect(got.alt).toBe('Alt two');
    expect(got.caption).toBe(
      'Caption <code>two</code> by <a href="https://github.com/o/r/blob/abc123/recordings/two.sh"><code>two.sh</code></a>.',
    );
  });

  it('stops when the README has no cell for that recording', () => {
    expect(() =>
      recordingOf({
        readme: cell('recordings/one.gif', 'a', 'b'),
        path: 'recordings/two.gif',
        facts: FACTS,
        docs: DOCS,
      }),
    ).toThrow(/recordings\/two\.gif/);
  });

  it("reads the real README: the proof's recording, a changed word caught, with the words the README gives it", () => {
    const got = recordingOf({
      readme: real,
      path: RECORDING,
      facts: { ...FACTS, repoUrl: 'https://github.com/felipesauer/mnema', sha: 'f'.repeat(40) },
      docs: DOCS,
    }) as { alt: string; caption: string };
    expect(RECORDING).toBe('recordings/a-tamper-caught.gif');
    expect(got.alt).toBe(
      "One word of a recorded decision changed by hand in the record's file, and mnema verify failing with entry hash mismatch",
    );
    expect(got.caption).toContain('A changed word caught: one word of an accepted decision');
    // The caption says what the recording does not show: nothing else holds this sentence on the page.
    expect(got.caption).toContain('a hash chain shows what changed, never what is gone');
    expect(got.caption).toContain(
      `href="https://github.com/felipesauer/mnema/blob/${'f'.repeat(40)}/recordings/a-tamper-caught.sh"`,
    );
    expect(got.caption).toContain(
      `href="https://github.com/felipesauer/mnema/blob/${'f'.repeat(40)}/docs/what-it-proves.md"`,
    );
  });

  const landing = (body: string, copy?: (key: string) => string): string =>
    templateOf({
      template: `---\ntitle: {{pitch.title}}\nbutton: {{label Install}}\n---\n\n${body}\n`,
      readme: real,
      facts: FACTS,
      docs: DOCS,
      copy,
    }) as string;

  it('fills {{label X}} with the label the README gives its Docs, and stops for one it does not', () => {
    expect(landing('')).toContain('button: "Install"');
    expect(() => landing('{{label Record}}')).toThrow(/no link labelled "Record"/);
  });

  it('fills {{copy key}} from the microcopy, and stops for a key it does not hold', () => {
    const copy = (key: string): string => {
      if (key !== 'a-key') throw new Error(`the copy has no "${key}"`);
      return 'A line of copy.';
    };
    expect(landing('{{copy a-key}}', copy)).toContain('A line of copy.');
    expect(() => landing('{{copy other}}', copy)).toThrow(/no "other"/);
  });
});

describe('site/copy.md is microcopy: a line for a key, and nothing that is a page', () => {
  const file = (...entries: string[]): string =>
    ['# Site copy', '', 'What this file is.', '', ...entries].join('\n');
  const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  it('reads a key and its one line, and ignores the title and the opening sentence', () => {
    const got = copyOf(file('## a-key', 'One line.', '', '## b-key', 'Another line.')) as Map<
      string,
      string
    >;
    expect([...got]).toEqual([
      ['a-key', 'One line.'],
      ['b-key', 'Another line.'],
    ]);
  });

  it('allows twenty words and stops at twenty-one', () => {
    expect((copyOf(file('## a-key', words(20))) as Map<string, string>).get('a-key')).toBe(
      words(20),
    );
    expect(() => copyOf(file('## a-key', words(21)))).toThrow(/a-key.*20 words/);
  });

  it('stops on a repeated key, an empty entry, an entry of two lines and a key that is not kebab-case', () => {
    expect(() => copyOf(file('## a-key', 'One.', '', '## a-key', 'Two.'))).toThrow(/a-key.*twice/);
    expect(() => copyOf(file('## a-key', '', '## b-key', 'Two.'))).toThrow(/a-key.*empty/);
    expect(() => copyOf(file('## a-key', 'One.', 'Still one?'))).toThrow(/a-key.*one line/);
    expect(() => copyOf(file('## A Key', 'One.'))).toThrow(/A Key/);
  });

  it('is read, as it stands, without a stop: the real file', () => {
    const real = copyOf(readFileSync(join(SITE, 'copy.md'), 'utf8')) as Map<string, string>;
    expect(real.size).toBeGreaterThan(0);
  });
});

describe('the verdict the landing shows is the one of the committed tree', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const home = mkdtempSync(join(tmpdir(), 'the-verdict-home-'));
  dirs.push(home);
  const identity = {
    HOME: home,
    PATH: process.env.PATH ?? '',
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@example.com',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@example.com',
  };
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      env: { ...identity, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
      encoding: 'utf8',
    });

  /** A throwaway repository holding a copy of this repository's record, and the path of one of its tails. */
  function copyOfTheRecord(): { repo: string; tail: string } {
    const repo = mkdtempSync(join(tmpdir(), 'the-verdict-'));
    dirs.push(repo);
    git(repo, 'init', '-q');
    cpSync(join(ROOT, '.mnema'), join(repo, '.mnema'), { recursive: true });
    const tails = join(repo, '.mnema', 'tails');
    const tail = readdirSync(tails)
      .map((d) => join(tails, d, '000001.jsonl'))
      .find(existsSync) as string;
    return { repo, tail };
  }

  /** One byte of the title of the first event, changed. */
  function change(tail: string): void {
    const text = readFileSync(tail, 'utf8');
    const at = text.indexOf('"title":"') + '"title":"'.length;
    expect(at).toBeGreaterThan('"title":"'.length);
    writeFileSync(tail, text.slice(0, at) + (text[at] === 'Z' ? 'Y' : 'Z') + text.slice(at + 1));
  }

  it('is the verdict of what git holds, not of what the working tree says now', () => {
    const { repo, tail } = copyOfTheRecord();
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'the record');
    const sha = git(repo, 'rev-parse', 'HEAD').trim();
    change(tail);

    const working = spawnSync(
      process.execPath,
      [join(ROOT, 'packages/code/dist/cli.js'), 'verify'],
      {
        cwd: repo,
        env: { HOME: home, PATH: process.env.PATH ?? '' },
        encoding: 'utf8',
      },
    );
    expect(working.status, 'the changed working tree does not verify').not.toBe(0);

    const said = theVerdictOfTheCommit({
      root: ROOT,
      repo,
      sha,
      command: 'mnema verify',
    }) as string;
    expect(said).toMatch(/^public: /);
    expect(said.trimEnd().split('\n')).toHaveLength(1);
  }, 60_000);

  it('stops, and says so, when the committed record does not verify', () => {
    const { repo, tail } = copyOfTheRecord();
    change(tail);
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'a record that was changed');
    const sha = git(repo, 'rev-parse', 'HEAD').trim();
    expect(() => theVerdictOfTheCommit({ root: ROOT, repo, sha, command: 'mnema verify' })).toThrow(
      /does not verify/,
    );
  }, 60_000);

  it('refuses a command that is not one of mnema', () => {
    expect(() => theVerdictOfTheCommit({ root: ROOT, sha: 'x', command: 'echo hi' })).toThrow(
      /mnema/,
    );
  });
});

describe('what the hero reads of the README: the line that installs, the three cards, the four steps', () => {
  const real = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const quick = (...lines: string[]): string =>
    ['## Quick start', '', '```sh', ...lines, '```', '', '## Next', ''].join('\n');
  const table = (heads: string[], cells: string[]): string =>
    `<table><tr>${heads.map((h) => `<th align="center">${h}</th>`).join('')}</tr><tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr></table>`;
  const how = (...items: string[]): string =>
    ['## How it works', '', ...items, '', '## Next', ''].join('\n');

  it('takes the first line of the Quick start up to the `#`', () => {
    expect(installLineOf(quick('npm i -g x   # the binary', 'x init'))).toBe('npm i -g x');
    expect(installLineOf(real)).toBe('npm i -g @mnema/code');
    expect(() => installLineOf(quick('# only a note'))).toThrow(/does not open with a command/);
  });

  it('takes the three headings and the three cells of the cards table, and stops for any other table', () => {
    const cards = ['Remember', 'Enforce', 'Prove'];
    expect(cardsOf(table(cards, ['one <b>x</b>', 'two', 'three']))).toEqual([
      { title: 'Remember', body: 'one x' },
      { title: 'Enforce', body: 'two' },
      { title: 'Prove', body: 'three' },
    ]);
    expect(() => cardsOf(table(['Remember', 'Enforce'], ['one', 'two']))).toThrow(
      /no table with Remember, Enforce, Prove/,
    );
    expect(() => cardsOf(table(['A', 'B', 'C'], ['1', '2', '3']))).toThrow(/no table with/);
    expect(() => cardsOf(table(cards, ['1', '', '3']))).toThrow(/3 titles and 3 cells/);
    expect((cardsOf(real) as { title: string }[]).map((c) => c.title)).toEqual(cards);
  });

  it('reads the table of the cards and not the first table of the README', () => {
    const above = table(['x', 'y', 'z'], ['a', 'b', 'c']);
    const got = cardsOf(
      `${above}\n${table(['Remember', 'Enforce', 'Prove'], ['one', 'two', 'three'])}`,
    );
    expect((got as { body: string }[]).map((c) => c.body)).toEqual(['one', 'two', 'three']);
  });

  const four = ['1. **A.** one', '2. **B.** two `c<d>`', '3. **C.** three', '4. **D.** four'];

  it('takes each step as a title without its full stop and a body with the code as code', () => {
    const got = stepsOf(how(...four), 'How it works') as {
      heading: string;
      steps: { title: string; body: string }[];
    };
    expect(got.heading).toBe('How it works');
    expect(got.steps.map((x) => x.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(got.steps[1]?.body).toBe('two <code>c&lt;d&gt;</code>');
    expect((stepsOf(real, 'How it works') as { steps: unknown[] }).steps).toHaveLength(4);
  });

  it('stops for a step with a link or emphasis, for five steps and for a section that is not there', () => {
    const last = (text: string): string => how(...four.slice(0, 3), `4. **D.** ${text}`);
    expect(() => stepsOf(last('see [it](x.md)'), 'How it works')).toThrow(/step 4/);
    expect(() => stepsOf(last('*four*'), 'How it works')).toThrow(/step 4/);
    expect(() => stepsOf(how(...four, '5. **E.** five'), 'How it works')).toThrow(
      /5 numbered steps/,
    );
    expect(() => stepsOf(how(...four), 'Nope')).toThrow(/no section "Nope"/);
  });

  it('stops for a numbered line that is not `N. **Title.** body`, and does not drop it', () => {
    expect(() => stepsOf(how(...four, '5. Verify it again.'), 'How it works')).toThrow(
      /numbered line/,
    );
    expect(() => stepsOf(how(...four.slice(0, 3), '4. D without bold.'), 'How it works')).toThrow(
      /numbered line.*4\. D/,
    );
  });
});

describe("the wordmark in the head of the site is the banner's letters, and only them", () => {
  const draw = async () => await import('../../../.github/the-front-page/draw.mjs');
  const accent = async () =>
    (await import('../../../.github/the-front-page/accent.mjs')).ACCENT as Record<string, string>;
  const pathOf = (svg: string, kind: string): string =>
    new RegExp(`data-of="${kind}"[^>]* d="([^"]*)"`).exec(svg)?.[1] ?? '';

  it('has a block where the console has one and a line where it has a line, and nothing else', async () => {
    const svg = (await draw()).headerWordmark(THE_BLOCKS, 'dark') as string;
    const glyphs = [...THE_BLOCKS.join('')].filter((g) => g !== ' ');
    const full = glyphs.filter((g) => g === '█').length;
    expect(pathOf(svg, 'blocks').match(/M/g)).toHaveLength(full);
    expect(pathOf(svg, 'lines').match(/M/g)).toHaveLength(2 * (glyphs.length - full));
    // Every full block, asked of the rows themselves: a cell at (column, row) starts a subpath at its corner.
    const corners = THE_BLOCKS.flatMap((row, r) =>
      [...row].flatMap((g, c) => (g === '█' ? [`M${c * 12} ${r * 24}h`] : [])),
    );
    for (const corner of corners) expect(pathOf(svg, 'blocks'), corner).toContain(corner);
    // No chain of cubes, no page, no glow, no words: two paths in a bare <svg>.
    expect(svg.match(/<(?!\/?svg\b|path\b)[a-z]/g) ?? []).toEqual([]);
    expect(svg.match(/<path\b/g)).toHaveLength(2);
    const width = Math.max(...THE_BLOCKS.map((row) => [...row].length)) * 12;
    expect(svg).toContain(`viewBox="0 0 ${width} `);
  });

  it('is painted in the accent of its theme and in no other colour', async () => {
    const colours = await accent();
    for (const theme of ['dark', 'light'] as const) {
      const svg = (await draw()).headerWordmark(THE_BLOCKS, theme) as string;
      expect([...new Set(svg.match(/#[0-9a-fA-F]{3,8}\b/g))]).toEqual([colours[theme]]);
    }
  });

  it('is written by the build, one per theme, byte for byte', async () => {
    const site = mkdtempSync(join(tmpdir(), 'the-wordmark-'));
    try {
      for (const file of ['landing.md', 'not-found.md', 'copy.md'])
        cpSync(join(SITE, file), join(site, file));
      await prepare({ root: ROOT, site });
      for (const theme of ['dark', 'light'] as const) {
        expect(readFileSync(join(site, `src/assets/wordmark-${theme}.svg`), 'utf8')).toBe(
          (await draw()).headerWordmark(THE_BLOCKS, theme),
        );
      }
    } finally {
      rmSync(site, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('the record page is in the sidebar, inside the group of the README that holds the verifier', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const docs = new Set(tracked('docs/*.md').map((f) => f.slice(5, -3)));
  const record = { label: 'Record', link: '/record/' };

  it('puts it right after the page that verifies itself, in the group Verify, and nowhere else', () => {
    const sidebar = sidebarOf({ readme, facts: FACTS, docs, record }) as {
      label: string;
      items: { label: string; link: string }[];
    }[];
    const verify = sidebar.find((g) => g.label === 'Verify');
    const at = verify?.items.findIndex((i) => i.label === 'The page that verifies itself') ?? -1;
    expect(at).toBeGreaterThanOrEqual(0);
    expect(verify?.items[at + 1]).toEqual(record);
    expect(
      sidebar.flatMap((g) => g.items).filter((i) => i.link === '/record/'),
      'one record item in the whole sidebar',
    ).toHaveLength(1);
    // Every top-level entry is a group of the README: the page is not hung beside them.
    expect(sidebar.map((g) => g.label)).toEqual(
      (groupsOf(readme) as { label: string }[]).map((g) => g.label),
    );
  });

  it('stops the build when the group or the item it goes after is not in the README, and does not hang it at the end', () => {
    const without = (from: string, to: string): string => readme.replace(from, to);
    expect(() =>
      sidebarOf({ readme: without('- **Verify.**', '- **Check.**'), facts: FACTS, docs, record }),
    ).toThrow(/no "The page that verifies itself" in its "Verify" group/);
    expect(() =>
      sidebarOf({
        readme: without('[The page that verifies itself]', '[The page that checks itself]'),
        facts: FACTS,
        docs,
        record,
      }),
    ).toThrow(/no "The page that verifies itself" in its "Verify" group/);
  });
});

describe('the social card is the banner and the pitch of the README on the dark page, and nothing else', () => {
  const draw = async () => await import('../../../.github/the-front-page/draw.mjs');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const pitch = pitchOf(readme) as { title: string; body: string };
  const card = async (): Promise<string> =>
    (await draw()).socialCard({ blocks: THE_BLOCKS, pitch }) as string;

  it('is 1200 by 630 and still: nothing animates, nothing is scripted', async () => {
    const svg = await card();
    expect(svg).toContain('width="1200" height="630" viewBox="0 0 1200 630"');
    expect(svg).not.toMatch(/<(animate|set|script|style)\b|animation|@keyframes|class="a"/);
  });

  it('says the title and the body of the pitch as its only words, in <text> of the front page sans face', async () => {
    const svg = await card();
    const lines = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? '');
    const unescaped = (s: string): string =>
      s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(unescaped(lines.join(' '))).toBe(`${pitch.title} ${pitch.body}`);
    // The only words in the file: what a tag does not hold, outside the <text> lines, is nothing.
    expect(
      svg
        .replace(/<text\b[^>]*>[^<]*<\/text>/g, '')
        .replace(/<[^>]*>/g, '')
        .trim(),
    ).toBe('');
    expect(svg).not.toMatch(/\saria-label=|<title>|<desc>/);
    for (const m of svg.matchAll(/<text\b[^>]*font-family="([^"]*)"/g)) {
      expect(m[1]).toContain('Segoe UI');
    }
    expect(lines.length).toBeGreaterThan(2);
  });

  it('draws the wordmark of the banner (the same paths the head draws) and the four cubes', async () => {
    const svg = await card();
    const head = (await draw()).headerWordmark(THE_BLOCKS, 'dark') as string;
    for (const kind of ['blocks', 'lines']) {
      const of = (s: string): string =>
        new RegExp(`data-of="${kind}"[^>]* d="([^"]*)"`).exec(s)?.[1] ?? '';
      expect(of(svg), kind).not.toBe('');
      expect(of(svg), `${kind} of the head's wordmark`).toBe(of(head));
    }
    // A cube is drawn as three faces and an outline: four of them, the last the most solid.
    expect(svg.match(/stroke-width="1.75" stroke-linejoin="round"/g) ?? []).toHaveLength(4);
  });

  it('paints the page and the accent of the dark theme, and greys: no other hue', async () => {
    const svg = await card();
    const { PAGE } = await draw();
    const { ACCENT } = await import('../../../.github/the-front-page/accent.mjs');
    expect(svg).toContain(`<rect width="1200" height="630" fill="${PAGE.dark}"/>`);
    const hues = new Set<string>();
    for (const [hex] of svg.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      if (Math.max(...channels) - Math.min(...channels) > 24) hues.add(hex.toLowerCase());
    }
    expect([...hues]).toEqual([ACCENT.dark]);
    expect(svg).not.toContain(ACCENT.light);
  });

  it('breaks its lines inside the margins, whatever the width of the letters', async () => {
    const svg = await card();
    for (const m of svg.matchAll(
      /<text\b[^>]*x="(\d+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g,
    )) {
      const width = [...(m[3] ?? '')].length * Number(m[2]) * 0.6;
      expect(Number(m[1]) + width, (m[3] ?? '').slice(0, 30)).toBeLessThanOrEqual(1200 - 80);
    }
  });
});

describe('what is tracked under site/', () => {
  const files = tracked('site/').filter((f) => !f.endsWith('package-lock.json'));

  it('is found at all, and holds the landing as a Markdown file that git lists', () => {
    expect(files).toContain('site/landing.md');
    expect(files).toContain('site/not-found.md');
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
