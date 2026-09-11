/**
 * THE HONEST GUARANTEE IS WORDED AS A PROOF, ON EVERY PAGE AND EVERYWHERE ONE IS NAMED.
 *
 * THE PREMISE THIS REPLACES. The README standard has always called the section
 * `What it proves — and what it does not` and called it mandatory for any package that
 * makes a claim. Two of the four wrote `What it guarantees` instead, and had since they
 * were written. That is not a cosmetic difference: the sentence this product sells says
 * the record is **tamper-evident, not tamper-proof** — it PROVES and does not GUARANTEE —
 * so a page whose heading says "guarantees" makes, in its title, the stronger claim the
 * promise had just been rewritten to refuse.
 *
 * THE DISCRIMINANT IS THE AFFIRMATION, NOT AN IDENTIFIER. There is no function to grep.
 * Sweeping for the heading's own tail — `— and what it does not` — over every tracked file
 * found SEVEN places, where a list made by reading the four package READMEs had two: the
 * format specification cites the section by name, and so does the doc-comment that holds
 * the product's promise. Neither is a README, and a rename that missed them would have
 * left two documents pointing at a section that no longer exists under that name.
 *
 * THE SEVENTH IS THE ONE WORTH WRITING DOWN. `plugin/README.md` carries
 * `## What it does — and what it does not`, which is a THIRD wording and is not a mistake:
 * that page documents an agent-host plugin rather than an `@mnema/*` package, and a plugin
 * makes no proof to be honest about. It is an allowed exception with its reason, held in
 * both directions, rather than a file quietly skipped.
 *
 * WHAT THE BODY CHECK IS AND IS NOT. Renaming a heading and leaving the prose underneath
 * promising the world would be trading a label. So each section is required to carry at
 * least THREE affirmations in the negative, from a declared list of forms. This is a
 * FLOOR, not a judgement of substance: measured on 11/09/2026 the four sections carry 11,
 * 13, 30 and 53 of them, so three is a floor a section that merely sells cannot reach and
 * a section written honestly cannot notice. What it does not do is read what the negatives
 * SAY — that stays a reviewer's job, and this file claims nothing more.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root, found by its MARKER and never by counting `..` upwards. */
const ROOT = ((): string => {
  let at = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(at, 'pnpm-workspace.yaml'))) return at;
    const up = dirname(at);
    if (up === at) throw new Error('no pnpm-workspace.yaml above this file');
    at = up;
  }
})();

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The section's name, as the README standard writes it. It is spelled here rather than
 * read out of that document, because the document is not committed — a case that read it
 * would pass over a file a clone does not have.
 */
const HONEST_GUARANTEE = 'What it proves — and what it does not';

/** The tail every wording of the heading shares — the discriminant the sweep runs on. */
const THE_TAIL = '— and what it does not';

/**
 * Where the tail appears in a wording that is not the canonical one, and why that is
 * right. Reconciled both ways: an entry whose file no longer reads that way is accused
 * just as loudly as a file that reads some other way and is not listed.
 */
const WORDED_OTHERWISE: readonly { file: string; heading: string; why: string }[] = [
  {
    file: 'plugin/README.md',
    heading: '## What it does — and what it does not',
    why: "It documents the agent-host plugin, not an `@mnema/*` package. A plugin wires a host to the product and proves nothing of its own, so the section it owes a reader is what it DOES — the standard's honest-guarantee section would have nothing to be honest about.",
  },
];

/** This file spells out every wording it rules on; an instrument that accuses itself is ignored. */
const THE_INSTRUMENT = 'packages/code/tests/every-readme-says-what-it-does-not.test.ts';

/** Affirmations in the negative. A section that only sells reaches none of these. */
const IN_THE_NEGATIVE: readonly string[] = [
  'does not',
  'do not',
  'cannot',
  'never',
  'is not',
  'are not',
  'not covered',
  'nothing',
];

/** The floor: three, against 11 in the thinnest section on the day this was measured. */
const NEGATIVES_FLOOR = 3;

/** Every `packages/<name>/README.md` on disk, by package name. */
function packageReadmes(): string[] {
  return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'README.md')),
    )
    .map((entry) => entry.name)
    .sort();
}

/** The body of a `##` section, from its heading to the next one. Empty when there is none. */
function sectionBody(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** How many affirmations in the negative a passage carries, counting every occurrence. */
function negatives(passage: string): number {
  const lower = passage.toLowerCase();
  return IN_THE_NEGATIVE.reduce((total, form) => total + lower.split(form).length - 1, 0);
}

/** Every tracked file that decodes as text, minus this instrument. */
function trackedText(): { file: string; text: string }[] {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const found: { file: string; text: string }[] = [];
  for (const file of listed) {
    if (file === THE_INSTRUMENT) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    found.push({ file, text });
  }
  return found;
}

/**
 * Every place a corpus names the heading's tail in a wording that is not the canonical
 * one, as `<file> :: <the line it is on, trimmed>`.
 */
function otherWordings(corpus: readonly { file: string; text: string }[]): string[] {
  const accused: string[] = [];
  for (const { file, text } of corpus) {
    for (const line of text.split('\n')) {
      if (!line.includes(THE_TAIL)) continue;
      if (line.includes(HONEST_GUARANTEE)) continue;
      accused.push(`${file} :: ${line.trim()}`);
    }
  }
  return accused.sort();
}

describe('every package page words its honest guarantee as a proof', () => {
  it('each one carries the canonical heading, exactly once', () => {
    const missing = packageReadmes().filter(
      (pkg) => read(`packages/${pkg}/README.md`).split(`\n## ${HONEST_GUARANTEE}\n`).length !== 2,
    );
    expect(missing).toEqual([]);
  });

  it('each section says what it does NOT cover, not only what it does', () => {
    const thin = packageReadmes()
      .map((pkg) => ({
        pkg,
        found: negatives(sectionBody(read(`packages/${pkg}/README.md`), HONEST_GUARANTEE)),
      }))
      .filter(({ found }) => found < NEGATIVES_FLOOR);
    expect(thin).toEqual([]);
  });
});

describe('nowhere names the section by another wording', () => {
  it('the sweep FIRES — a page worded otherwise is named, with its line', () => {
    // Written here, not read off the disk: a sweep whose instrument is never shown to
    // fire reports zero when it is broken, and zero is what a healthy tree looks like.
    const corpus = [
      { file: 'control.md', text: `# A page\n\n## What it guarantees ${THE_TAIL}\n\nprose\n` },
      { file: 'clean.md', text: `# A page\n\n## ${HONEST_GUARANTEE}\n\nprose\n` },
    ];
    expect(otherWordings(corpus)).toEqual([`control.md :: ## What it guarantees ${THE_TAIL}`]);
  });

  it('the sweep reads the whole tracked tree, not a handful of files', () => {
    const corpus = trackedText();
    expect(corpus.length).toBeGreaterThan(500);
    expect(corpus.map((entry) => entry.file)).toContain('packages/chain/FORMAT.md');
    expect(corpus.map((entry) => entry.file)).toContain('packages/code/src/promise.ts');
  });

  it('nothing tracked words it otherwise, but what is declared to', () => {
    const allowed = new Set(WORDED_OTHERWISE.map(({ file, heading }) => `${file} :: ${heading}`));
    expect(otherWordings(trackedText()).filter((hit) => !allowed.has(hit))).toEqual([]);
  });

  it('every declared exception still reads the way it says it does', () => {
    const stale = WORDED_OTHERWISE.filter(({ file, heading }) => !read(file).includes(heading)).map(
      ({ file }) => file,
    );
    expect(stale).toEqual([]);
  });
});

describe('the negative-count reading FIRES', () => {
  it('a passage that only sells reaches nothing', () => {
    expect(negatives('It guarantees integrity and proves every fact it holds.')).toBe(0);
  });

  it('a passage that states its limits is counted, occurrence by occurrence', () => {
    expect(negatives('It does not sign what it does not hold, and it can never date it.')).toBe(3);
  });

  it('the section reader stops at the next heading', () => {
    const page = `# P\n\n## ${HONEST_GUARANTEE}\n\ninside\n\n## Install\n\noutside\n`;
    expect(sectionBody(page, HONEST_GUARANTEE)).toContain('inside');
    expect(sectionBody(page, HONEST_GUARANTEE)).not.toContain('outside');
  });

  it('a page with no such section reads as empty rather than as the whole page', () => {
    expect(sectionBody('# P\n\n## Install\n\nprose\n', HONEST_GUARANTEE)).toBe('');
  });
});
