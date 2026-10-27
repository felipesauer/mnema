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
import { prepare } from '../../../site/build/the-build.mjs';
import {
  copyOf,
  landingOf,
  llmsTxt,
  pageOf,
  recordBackLink,
  recordingOf,
  rewriteLinks,
  textAccent,
  themeCss,
  themeOf,
  titleOf,
  verifyCommandOf,
  whereItLands,
  withoutWhatIsNotOnTheSite,
} from '../../../site/build/the-pages.mjs';
import { theVerdictOfTheCommit, writeTheRecord } from '../../../site/build/the-record.mjs';
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
    for (const file of ['landing.md', 'copy.md']) cpSync(join(SITE, file), join(site, file));
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
    expect(proof.recording.src).toBe(`${facts.base}/recordings/a-write-refused.gif`);
    const gif = readFileSync(join(ROOT, 'recordings/a-write-refused.gif'));
    expect(proof.recording).toMatchObject({
      width: gif.readUInt16LE(6),
      height: gif.readUInt16LE(8),
    });
    expect(readFileSync(join(site, 'public/recordings/a-write-refused.gif')).equals(gif)).toBe(
      true,
    );
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

  it('reads the real README: the recording of a write refused, with the words the README gives it', () => {
    const got = recordingOf({
      readme: real,
      path: 'recordings/a-write-refused.gif',
      facts: { ...FACTS, repoUrl: 'https://github.com/felipesauer/mnema', sha: 'f'.repeat(40) },
      docs: DOCS,
    }) as { alt: string; caption: string };
    expect(got.alt).toBe("An agent's write refused by a rule addressed at its path");
    expect(got.caption).toContain('A write refused: the rule addressed at the path');
    expect(got.caption).toContain(
      `href="https://github.com/felipesauer/mnema/blob/${'f'.repeat(40)}/recordings/a-write-refused.sh"`,
    );
  });

  const landing = (body: string, copy?: (key: string) => string): string =>
    landingOf({
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
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? '',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@example.com',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@example.com',
  };
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, stdio: 'pipe', env, encoding: 'utf8' });

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
