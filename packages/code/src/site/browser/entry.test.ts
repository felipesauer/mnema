/**
 * What the page's script writes where the page keeps the verdict.
 *
 * The verdict itself is pinned against `mnema verify` in `the-verdict-in-the-browser.test.ts`,
 * which runs the BUNDLE with the disk taken away. This one runs the module in Node, where the
 * chain reads the real disk, so it holds only what does not depend on the files: that an empty
 * page claims nothing, that a failure to verify is said as not verified, and that the verdict
 * lands as text and never as markup.
 */

import { describe, expect, it } from 'vitest';
import { showVerdict, verifyRecord } from './entry.js';

interface Fake {
  textContent: string | null;
  attributes: Record<string, string>;
  children: Fake[];
  setAttribute(name: string, value: string): void;
  appendChild(child: Fake): void;
}

function fake(): Fake {
  const made: Fake = {
    textContent: null,
    attributes: {},
    children: [],
    setAttribute: (name, value) => {
      made.attributes[name] = value;
    },
    appendChild: (child) => {
      made.children.push(child);
    },
  };
  return made;
}

function aPage(): { page: Parameters<typeof showVerdict>[0]; by: Record<string, Fake> } {
  const by = { 'verdict-status': fake(), 'verdict-summary': fake(), 'verdict-issues': fake() };
  return {
    by,
    page: {
      getElementById: (id: string) => by[id as keyof typeof by] ?? null,
      createElement: () => fake(),
    },
  };
}

describe('the page script', () => {
  it('claims nothing for a page that carries no files', () => {
    const { page, by } = aPage();
    showVerdict(page, {});
    expect(by['verdict-status'].attributes['data-state']).toBe('unverified');
    expect(by['verdict-status'].textContent).toBe('not verified');
    expect(by['verdict-summary'].textContent).toBe(
      'This page carries no record files, so nothing was verified.',
    );
  });

  it('says it could not verify, and why, when the verifier throws', () => {
    const { page, by } = aPage();
    showVerdict(page, { 'tails/x/000001.jsonl': '***not base64***' });
    expect(by['verdict-status'].attributes['data-state']).toBe('unverified');
    expect(by['verdict-summary'].textContent).toMatch(/^The page could not run the verification: /);
  });

  it("hands back the chain's own words, as plain fields", () => {
    const verdict = verifyRecord({});
    expect(Object.keys(verdict).sort()).toEqual(
      ['census', 'clauses', 'fullySigned', 'issues', 'level', 'ok', 'summary'].sort(),
    );
    expect(verdict.summary).toBe(verdict.clauses.join('; '));
  });
});
