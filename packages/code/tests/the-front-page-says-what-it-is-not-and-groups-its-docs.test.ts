/**
 * THE FRONT PAGE SAYS WHAT MNEMA IS NOT, AND GROUPS ITS DOCS BY WHO READS THEM — and neither can
 * drift from the page it summarises or from the directory it lists.
 *
 *   - "WHAT IT IS NOT" has four lines, and each one is the line of `docs/where-it-fits.md` said
 *     short. A line is held to the label the page gives it and to the sentences of the page it
 *     rests on ({@link LINES}): were the page to change one, the front page could not go on saying
 *     another thing without this failing. The page carries the reason; the front page carries the
 *     claim and a link to the page.
 *   - "DOCS" has four groups, in the order a reader comes to them — use, verify, integrate,
 *     contribute — and every link in them lands on a file that exists.
 *   - EVERY PAGE OF `docs/` IS IN ONE GROUP, or is on {@link LEFT_OUT} with its reason. A page added
 *     to `docs/` and linked from nowhere fails here, rather than being found by whoever looks for
 *     it. {@link LEFT_OUT} is held in both directions: a page on it that is now linked, or that
 *     is gone, fails too.
 *
 * WHAT IT DOES NOT CHECK: whether a page sits in the group a reader would look in. The groups are a
 * judgement, held to their labels and their order, and to nothing about which page is where.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, read } from './support/published-examples.js';

const README = read('README.md');
const WHERE_IT_FITS = read('docs/where-it-fits.md');

/** One whitespace for any run of it, so a line wrapped on the page is the same sentence. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** The body of a `## ` section — from under its heading to the next heading of the same level. */
function sectionOf(page: string, heading: string): string {
  const lines = page.split('\n');
  const from = lines.indexOf(`## ${heading}`);
  if (from < 0) throw new Error(`the page has no "## ${heading}" section`);
  const rest = lines.slice(from + 1);
  const next = rest.findIndex((line) => line.startsWith('## '));
  return rest.slice(0, next < 0 ? undefined : next).join('\n');
}

/** The bullets of a section: each starts at a `- ` and runs until the next one or a blank line. */
function bulletsOf(section: string): string[] {
  const bullets: string[] = [];
  for (const line of section.split('\n')) {
    if (line.startsWith('- ')) bullets.push(line.slice(2));
    else if (line.trim() !== '' && bullets.length > 0 && /^\s/.test(line)) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    }
  }
  return bullets.map(flat);
}

/**
 * The four lines, in the page's order. `label` is the bold label both pages carry; `rests` are
 * the sentences of `docs/where-it-fits.md` that the front page's line says, each of them found on
 * the page and in the line.
 */
const LINES: readonly { label: string; rests: readonly string[] }[] = [
  {
    label: 'Not a semantic memory.',
    rests: ['Search is by the words written in a record', 'there are no embeddings'],
  },
  {
    label: 'Not an agent runner.',
    rests: ['It calls no model and runs no tool for the agent'],
  },
  {
    label: 'Not a copy somewhere else.',
    rests: [
      "what you record privately stays on this machine, apart from the notes the plugin hands your agent's host when a session opens, which the host sends to its model",
      'only when you run them',
    ],
  },
  {
    label: 'Not access control.',
    rests: ['it does not decide who may write'],
  },
];

describe('"What it is not" on the front page', () => {
  const mine = bulletsOf(sectionOf(README, 'What it is not'));
  const theirs = bulletsOf(sectionOf(WHERE_IT_FITS, 'What it is not'));

  it('has the four lines of the page, in its order, under its labels', () => {
    expect(mine.map((b) => b.slice(0, b.indexOf('**', 2) + 2))).toEqual(
      LINES.map((l) => `**${l.label}**`),
    );
    expect(theirs.map((b) => b.slice(0, b.indexOf('**', 2) + 2))).toEqual(
      LINES.map((l) => `**${l.label}**`),
    );
  });

  it.each(LINES.map((l, at) => [l.label, at] as const))(
    'has on "%s" each sentence of the page that the front page repeats, in both texts',
    (_label, at) => {
      for (const rest of LINES[at]?.rests ?? []) {
        expect(theirs[at], `the page no longer says: ${rest}`).toContain(rest);
        expect(mine[at], `the front page no longer says: ${rest}`).toContain(rest);
      }
    },
  );

  it('keeps each line short, and sends the reader to the page that gives the reasons', () => {
    for (const line of mine) expect(line.length).toBeLessThan(400);
    expect(sectionOf(README, 'What it is not')).toContain('(docs/where-it-fits.md#what-it-is-not)');
  });
});

/** The groups of "Docs", in the order the front page shows them. */
const GROUPS = ['Use', 'Verify', 'Integrate', 'Contribute'] as const;

/**
 * Pages of `docs/` the groups do not list, each with the reason. Empty today: every page is in a
 * group. A page is added here only with the reason it is not for any of the four readers.
 */
const LEFT_OUT: Readonly<Record<string, string>> = {};

/** `[label](target)` of a bullet, the target with no anchor. */
function linksOf(bullet: string): string[] {
  return [...bullet.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => (m[1] ?? '').split('#')[0] ?? '');
}

describe('"Docs" on the front page', () => {
  const bullets = bulletsOf(sectionOf(README, 'Docs'));
  const grouped = bullets.map((b) => ({
    label: b.slice(2, b.indexOf('.**')),
    links: linksOf(b),
  }));

  it('has four groups — use, verify, integrate, contribute — in that order', () => {
    expect(grouped.map((g) => g.label)).toEqual([...GROUPS]);
    for (const b of bullets) expect(b).toMatch(/^\*\*[A-Z][a-z]+\.\*\* \[/);
  });

  it('links only files that exist', () => {
    for (const { label, links } of grouped) {
      expect(links.length, `the group "${label}" has no link`).toBeGreaterThan(0);
      for (const link of links) {
        expect(existsSync(join(ROOT, link)), `${label}: ${link} does not exist`).toBe(true);
      }
    }
  });

  it('puts every page of docs/ in a group, or on the list of what is left out with a reason', () => {
    const linked = new Set(grouped.flatMap((g) => g.links));
    const pages = readdirSync(join(ROOT, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/${f}`);
    for (const page of pages) {
      expect(
        linked.has(page) || page in LEFT_OUT,
        `${page} is in no group of "Docs" and is not left out with a reason`,
      ).toBe(true);
    }
    for (const [page, why] of Object.entries(LEFT_OUT)) {
      expect(why.length, `${page} is left out with no reason`).toBeGreaterThan(10);
      expect(pages, `${page} is left out and does not exist`).toContain(page);
      expect(linked.has(page), `${page} is left out and is linked`).toBe(false);
    }
  });

  it('lists a page once, in one group', () => {
    const all = grouped.flatMap((g) => g.links);
    expect(all.filter((l, i) => all.indexOf(l) !== i)).toEqual([]);
  });

  it('carries the glossary among the readers of the product, and the convergence among the proofs', () => {
    const at = (label: string) => grouped.find((g) => g.label === label)?.links ?? [];
    expect(at('Use')).toContain('docs/glossary.md');
    expect(at('Verify')).toContain('docs/convergence.md');
  });
});
