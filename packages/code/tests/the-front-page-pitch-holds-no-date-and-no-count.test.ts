// @reads-the-tree
/**
 * THE PITCH HOLDS NO DATE AND NO COUNT. The top of the README (what comes before `## Why`) and the
 * `## Why` section are what a stranger reads first, and they must not carry what goes stale or what
 * sells with a number: a date, a count of tests or of test files, a percentage, a count of hosts or
 * of tools, or a promise tied to a date. The numbers that are true on every day stay (a version, the
 * Node floor, an ADR's name, "two doors"): the patterns below name the shapes, not every digit.
 *
 * The SVG text has its own guard in `the-front-page-is-drawn-from-the-console.test.ts`; its host and
 * count pattern is written inline there, so the count-of-hosts pattern here is a second copy of it.
 *
 * The two sections are found by their headings. If the README stops having them, this file fails
 * loudly instead of reading nothing and passing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

const MONTH =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
const MES =
  '(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
const NUMBER_WORD =
  '(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred)';

/** Each class of what the pitch must not hold, with the pattern that finds it. */
const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'an ISO date', pattern: /\b\d{4}-\d{2}-\d{2}(?!\d)/ },
  { name: 'a numeric date', pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/ },
  {
    // Case-sensitive on the month, so the verb "may" and "march" in prose stay out.
    name: 'a date written out',
    pattern: new RegExp(
      `\\b${MONTH}\\.?\\s+\\d|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b|\\b\\d{1,2}\\s+de\\s+${MES}\\b|\\b${MES}\\s+de\\s+\\d{4}`,
    ),
  },
  {
    name: 'a count of tests',
    pattern:
      /\b\d[\d,._]*\s+(?:\w+\s+)?(?:tests?|test\s+files?|specs?|assertions?)\b|\btests?\s+(?:pass|passes|passed|passing)\b/i,
  },
  { name: 'coverage', pattern: /\bcoverage\b/i },
  { name: 'a percentage', pattern: /\d(?:[.,]\d+)?\s*%|\bper\s?cent\b/i },
  {
    name: 'a count of hosts, tools, kinds or events',
    pattern: new RegExp(
      `\\b\\d+\\s+(?:kinds?|hosts?|tools?|events?)\\b|\\b${NUMBER_WORD}\\s+(?:kinds|hosts|tools|events)\\b`,
      'i',
    ),
  },
  {
    name: 'a promise tied to a date',
    pattern:
      /coming soon|next (?:week|month|release)|will be (?:published|released|available) (?:on|in|by)\b/i,
  },
];

/** The classes that fire on `text`. */
function violations(text: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/** The words of a README span: a tag keeps its `alt` and nothing else (an address or a width is not prose). */
function proseOf(span: string): string {
  return span.replace(/<[^>]*>/g, (tag) => {
    const alt = /\balt="([^"]*)"/.exec(tag);
    return alt ? ` ${alt[1]} ` : ' ';
  });
}

/** The hero (everything before `## Why`) and the Why section (up to the next `## `), or a loud refusal. */
function pitchOf(readme: string): { hero: string; why: string } {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l === '## Why');
  if (start < 0) {
    throw new Error(
      'The README has no `## Why` heading: the pitch guard cannot find the Why section. Rename it back, or update this guard.',
    );
  }
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) {
    throw new Error(
      'The README has no section after `## Why`: the guard cannot tell where it ends.',
    );
  }
  const hero = lines.slice(0, start).join('\n');
  const why = lines.slice(start + 1, end).join('\n');
  if (hero.trim().length < 200 || why.trim().length < 200) {
    throw new Error(
      'The hero or the Why section is nearly empty: the guard would pass over nothing.',
    );
  }
  return { hero: proseOf(hero), why: proseOf(why) };
}

const readme = readFileSync(join(REPO, 'README.md'), 'utf-8');

describe('the README hero and Why hold no date and no count', () => {
  const pitch = pitchOf(readme);

  it('reads a hero and a Why of real length', () => {
    expect(pitch.hero).toContain('decision record for AI coding agents');
    expect(pitch.why).toContain('Your agents settle choices all day');
  });

  it('holds nothing forbidden in the hero', () => {
    expect(violations(pitch.hero)).toEqual([]);
  });

  it('holds nothing forbidden in the Why section', () => {
    expect(violations(pitch.why)).toEqual([]);
  });
});

describe('each class lights when its defect is put back', () => {
  it.each([
    ['2026-10-16', 'an ISO date'],
    ['Released 2026-10-16T09:00:00Z.', 'an ISO date'],
    ['Written on 16/10/2026.', 'a numeric date'],
    ['Shipped Oct 16.', 'a date written out'],
    ['Shipped on 16 October', 'a date written out'],
    ['Shipped October 2026', 'a date written out'],
    ['lançado em 16 de outubro', 'a date written out'],
    ['8,595 tests', 'a count of tests'],
    ['611 test files', 'a count of tests'],
    ['All tests pass.', 'a count of tests'],
    ['1200 assertions', 'a count of tests'],
    ['100% coverage', 'coverage'],
    ['Branch coverage is high.', 'coverage'],
    ['94%', 'a percentage'],
    ['12.5 % of writes', 'a percentage'],
    ['Works with 14 hosts', 'a count of hosts, tools, kinds or events'],
    ['fourteen hosts', 'a count of hosts, tools, kinds or events'],
    ['exposes 22 tools', 'a count of hosts, tools, kinds or events'],
    ['Coming soon on npm', 'a promise tied to a date'],
    ['Out next week', 'a promise tied to a date'],
    ['It will be published on the first of the month', 'a promise tied to a date'],
  ])('%s', (text, cls) => {
    expect(violations(text)).toContain(cls);
  });

  it('lets through what is true on every day', () => {
    const fine = [
      'Version 0.1.0-beta needs Node 22.12 or later.',
      'See ADR-2: two doors, one record.',
      'Requires Node 24.15.0 or a later 24, or 26.0.0 or later.',
      'The record holds many tests of its own, and one is named in docs/evidence.md.',
      'You may sign it in May, or in March; the five packages are listed in the docs.',
    ].join('\n');
    expect(violations(fine)).toEqual([]);
  });

  it('does not read an encoded address as a percentage', () => {
    const tag =
      '<img src="https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C-x" alt="Node 24.15.0">';
    expect(violations(proseOf(tag))).toEqual([]);
  });
});

describe('the guard refuses to read nothing', () => {
  it('fails loudly when the Why heading is renamed', () => {
    const renamed = readme.replace('\n## Why\n', '\n## Motivation\n');
    expect(renamed).not.toBe(readme);
    expect(() => pitchOf(renamed)).toThrow(/no `## Why` heading/);
  });

  it('fails loudly when the Why section is emptied', () => {
    const lines = readme.split('\n');
    const at = lines.indexOf('## Why');
    const next = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    const emptied = [...lines.slice(0, at + 1), '', ...lines.slice(next)].join('\n');
    expect(() => pitchOf(emptied)).toThrow(/nearly empty/);
  });

  it('sees a date put into the real Why section', () => {
    const planted = readme.replace('## Why\n', '## Why\n\nSince 2026-10-16.\n');
    expect(violations(pitchOf(planted).why)).toEqual(['an ISO date']);
  });

  it('sees a count put into the real hero', () => {
    const planted = readme.replace('<h3>', '<h3>8,595 tests. ');
    expect(violations(pitchOf(planted).hero)).toEqual(['a count of tests']);
  });
});
