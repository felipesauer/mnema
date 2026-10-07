/**
 * THE EVIDENCE PAGE CITES ONLY WHAT EXISTS — every file `docs/evidence.md` names as the thing
 * that holds a claim is a file of this tree.
 *
 * The page is a table from a claim to what holds it. A row whose file was renamed, or never
 * written, is a claim presented as held by something that is not there, which is worse than a
 * claim that says it is not held yet. Nothing else reads the page's links: the sweep that lands
 * every link (`every-link-a-page-carries-lands.test.ts`) would catch a dead link, but not a
 * path written in code marks, and not a table that stopped naming anything.
 *
 * WHAT IT READS: each relative link destination (from the page's own directory) and each code
 * span that is a path with a directory in it (from the root). Both are asked of `git ls-files`,
 * the files the repository hands out, and not of the disk, so an untracked file on a machine
 * is not a witness.
 *
 * WHAT IT DOES NOT CHECK: that the file holds the claim beside it. That is a reviewer's reading.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, read } from './support/published-examples.js';

const PAGE = 'docs/evidence.md';

/** Every file the repository tracks, as root-relative paths. */
function tracked(): ReadonlySet<string> {
  return new Set(
    execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  );
}

/** The files a page cites: root-relative paths, in the order the page names them. */
function filesCitedBy(page: string, text: string): string[] {
  const cited: string[] = [];
  for (const link of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (link[1] as string).split('#')[0] as string;
    if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    cited.push(normalize(join(dirname(page), target)));
  }
  for (const span of text.matchAll(/`([^`\s]+)`/g)) {
    const word = span[1] as string;
    if (/^[\w@.-]+(\/[\w@.-]+)+$/.test(word)) cited.push(word);
  }
  return cited;
}

describe('the evidence page cites only what exists', () => {
  const text = read(PAGE);
  const cited = filesCitedBy(PAGE, text);

  it('names a file of the tree for every claim it says a test holds', () => {
    const files = tracked();
    expect(cited.filter((file) => !files.has(file))).toEqual([]);
  });

  it('names enough files to be a table and not an empty promise', () => {
    // NON-VACUITY. A page that stopped naming files, or a reading that stopped seeing them,
    // leaves the case above holding over nothing.
    expect(new Set(cited).size).toBeGreaterThan(10);
    expect(cited).toContain('packages/code/tests/the-rule-reaches-the-writing.test.ts');
  });

  it('lights on a file that is not there, whether it is a link or a code span', () => {
    const files = tracked();
    const missing = 'packages/code/tests/a-test-nobody-wrote.test.ts';
    expect(files.has(missing)).toBe(false);
    const asLink = filesCitedBy(PAGE, `| a claim | a test | [\`x.test.ts\`](../${missing}) |`);
    const asSpan = filesCitedBy(PAGE, `| a claim | a test | \`${missing}\` |`);
    expect(asLink).toEqual([missing]);
    expect(asSpan).toEqual([missing]);
  });

  it('gives each claim it does not hold the words "not held yet", with no file beside them', () => {
    const notHeld = text.split('\n').filter((line) => line.includes('not held yet'));
    expect(notHeld.length).toBeGreaterThan(5);
    expect(notHeld.filter((line) => filesCitedBy(PAGE, line).length > 0)).toEqual([]);
  });
});
