/**
 * A pull request whose title, description or commit message carries the em dash is refused,
 * and the finding says where. The text is the pull request's own, so the cases hand the
 * function titles, descriptions and commits and read the findings as values.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dashesIn, THE_DASH } from '../../../.github/the-pull-request-text/check.mjs';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const DASH = String.fromCharCode(0x2014);

describe('the pull request text', () => {
  it('knows the character it refuses', () => {
    expect(THE_DASH).toBe(DASH);
    expect(THE_DASH.codePointAt(0)).toBe(0x2014);
  });

  it('lets a clean pull request through', () => {
    const commits = [
      { sha: 'a'.repeat(40), message: 'Fix the thing\n\nA body, with a colon: ok.' },
    ];
    expect(dashesIn({ title: 'Fix the thing', body: 'one\ntwo\nthree', commits })).toEqual([]);
  });

  it('names the title', () => {
    expect(dashesIn({ title: `Fix ${DASH} the thing`, body: 'clean' })).toEqual([
      `title: Fix ${DASH} the thing`,
    ]);
  });

  it('names the line of the description', () => {
    const body = `one\ntwo\nthree ${DASH} three`;
    expect(dashesIn({ title: 'ok', body })).toEqual([`body, line 3: three ${DASH} three`]);
  });

  it('names the commit and its line', () => {
    const commits = [
      { sha: 'b'.repeat(40), message: 'clean' },
      { sha: 'c'.repeat(40), message: `subject\n\nbody ${DASH} here` },
    ];
    expect(dashesIn({ title: 'ok', body: null, commits })).toEqual([
      `commit ${'c'.repeat(12)}, line 3: body ${DASH} here`,
    ]);
  });
});

describe('the job that runs it', () => {
  const workflow = readFileSync(join(REPO, '.github/workflows/the-pull-request-text.yml'), 'utf-8');

  it('runs when the text is edited, and never puts the text in a shell', () => {
    expect(workflow).toContain('name: the pull request text');
    expect(workflow).toContain('types: [opened, edited, synchronize, reopened]');
    expect(workflow).toContain('run: node .github/the-pull-request-text/check.mjs');
    expect(workflow).not.toContain('github.event.pull_request.title');
    expect(workflow).not.toContain('github.event.pull_request.body');
  });
});
