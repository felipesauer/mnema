/**
 * `FORMAT.md` is the format specified in prose, for a reader who did not write
 * this code. Prose has one failure mode a test file does not: it stays green
 * forever. These guards are what stop it from describing a format nobody writes
 * any more.
 *
 * THREE THINGS ARE HELD, and each is a way the document could quietly go wrong:
 *   - a VERSION TAG typed into prose. The document names the two hash domains and
 *     the checkpoint scheme. Bumping one in the code would leave the document
 *     describing the old one, so the tags are read out of the source here and the
 *     document is checked against them — never the other way round.
 *   - a CITATION that no longer resolves. Every behavioural claim in the document
 *     names the test that holds it; a renamed or deleted test turns that citation
 *     into a claim with nothing behind it, which is the exact thing the citations
 *     exist to prevent.
 *   - a POINTER to the artifact. The document tells a stranger to download
 *     `canonical-vectors.json`, and the vectors module resolves the same file by
 *     path. Two names for one file is two names that can come to differ, so the
 *     document is checked against the module's own constant, and the file is
 *     checked to be one the repository actually carries — the only channel it
 *     travels by (see the document's last section).
 *
 * WHAT IS DELIBERATELY NOT HELD HERE: whether each claim is TRUE. That is the
 * cited test's job, and a guard that tried to do it here would be a second
 * implementation of every one of them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SCHEME } from './chain/checkpoint.js';
import { ENTRY_DOMAIN, ROOT_DOMAIN } from './chain/hash.js';
import { VECTORS_FILE, VECTORS_FILE_NAME } from './events/vectors.js';

/** The package root: where `FORMAT.md`, `README.md` and the artifact live. */
const PACKAGE = new URL('../', import.meta.url);
const FORMAT_PATH = new URL('FORMAT.md', PACKAGE);
const FORMAT = readFileSync(FORMAT_PATH, 'utf-8');

/** The repository root, three levels up from `src/`. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

describe('FORMAT.md names the versions the code hashes under', () => {
  it('writes no domain tag the code does not define', () => {
    const written = [...FORMAT.matchAll(/mnema\.[a-z.]+\.v\d+/g)].map((m) => m[0]);
    // NON-VACUITY: a document that mentioned no tag at all would pass a subset
    // check trivially, so the count is asserted before the membership is.
    expect(written.length).toBeGreaterThan(0);
    expect([...new Set(written)].sort()).toEqual([ENTRY_DOMAIN, ROOT_DOMAIN].sort());
  });

  it('writes no scheme tag but the one a checkpoint declares', () => {
    // The pattern is the CLASS, not the instance: this codebase has more than one
    // `mnema-<thing>/<n>` scheme (a tail proof carries its own), and a document that
    // grew a section about another one would name a version no guard here read. So
    // any scheme tag the document writes has to be a constant the code exports — a
    // new section has to export its own before it can name it.
    const written = [...FORMAT.matchAll(/mnema-[a-z]+\/\d+/g)].map((m) => m[0]);
    expect(written.length).toBeGreaterThan(0);
    expect([...new Set(written)]).toEqual([SCHEME]);
  });
});

describe('FORMAT.md cites tests that exist', () => {
  /** Every repo-relative test path the document names inside backticks. */
  const cited = [
    ...new Set([...FORMAT.matchAll(/`(packages\/[^`]+\.test\.ts)`/g)].map((m) => m[1])),
  ];

  it('names at least one test per section that makes a claim', () => {
    // The document has eight sections that assert behaviour. The floor is not the
    // section count — sections move — but it is high enough that a rewrite which
    // dropped the citations cannot pass.
    expect(cited.length).toBeGreaterThanOrEqual(6);
  });

  it('names only tests the repository holds', () => {
    const missing = cited.filter((path) => path !== undefined && !existsSync(`${REPO}${path}`));
    expect(missing, 'FORMAT.md cites a test that is not there').toEqual([]);
  });
});

describe('FORMAT.md points at the artifact the code resolves', () => {
  it('names the file the vectors module names, and no other vectors file', () => {
    expect(FORMAT).toContain(`\`${VECTORS_FILE_NAME}\``);
    const named = [
      ...new Set([...FORMAT.matchAll(/`([\w-]*vectors[\w-]*\.json)`/g)].map((m) => m[1])),
    ];
    expect(named).toEqual([VECTORS_FILE_NAME]);
  });

  it('points at a file that is there', () => {
    expect(existsSync(fileURLToPath(VECTORS_FILE))).toBe(true);
  });

  it('points at a file the repository carries, since that is its only channel', () => {
    // The artifact reaches a stranger by being IN the repository — it is in no npm
    // tarball, and `FORMAT.md` says so. A path that a `.gitignore` swallowed would
    // publish nothing while every other case here stayed green, and this tree
    // ignores whole directories by name (`dist/`, `scripts/`, `.refactor/`), so
    // the hazard is real rather than theoretical. `git` is asked directly.
    const relative = fileURLToPath(VECTORS_FILE).slice(REPO.length);
    const tracked = execFileSync('git', ['ls-files', '--', relative], {
      cwd: REPO,
      encoding: 'utf-8',
    }).trim();
    expect(tracked, `${relative} is not tracked by git`).toBe(relative);
  });

  it('is reachable from the package’s README, which is what a reader opens first', () => {
    expect(readFileSync(new URL('README.md', PACKAGE), 'utf-8')).toContain('FORMAT.md');
  });
});
