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
 *   - a POINTER to an artifact, of which there are now TWO: the document tells a
 *     stranger to download `canonical-vectors.json` (the exemplars) and
 *     `event-schema.json` (the declarations), and a module resolves each of them by
 *     path. Two names for one file is two names that can come to differ, so the
 *     document is checked against each module's own constant, and each file is
 *     checked to be one the repository actually carries — the only channel they
 *     travel by (see the document's last section).
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
import { TAILPROOF_SCHEME } from './chain/tailproof.js';
import { SCHEMA_FILE, SCHEMA_FILE_NAME } from './events/schema.js';
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

  it('writes no scheme tag the code does not export', () => {
    // The pattern is the CLASS, not the instance: this codebase has more than one
    // `mnema-<thing>/<n>` scheme, and a document that grew a section about another one
    // would name a version no guard here read. So any scheme tag the document writes has
    // to be a constant the code exports — a new section has to export its own before it
    // can name it.
    //
    // THE TAIL PROOF IS THE SECTION THAT ARRIVED. This case expected exactly the
    // checkpoint's scheme for as long as the document said nothing about `tailproof.json`
    // — which is how an artifact sat in every tail directory, signed, with no description
    // anywhere. An independent verifier written from this document found it and had to try
    // five candidate messages to learn what it signs (gap G10). The document has a section
    // for it now, so the expected set is both exported constants, and a THIRD scheme still
    // has to export its own to be nameable.
    const written = [...FORMAT.matchAll(/mnema-[a-z]+\/\d+/g)].map((m) => m[0]);
    expect(written.length).toBeGreaterThan(0);
    expect([...new Set(written)].sort()).toEqual([SCHEME, TAILPROOF_SCHEME].sort());
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

/**
 * THERE ARE TWO ARTIFACTS NOW, and the rule is the same for both: the document, the
 * module that resolves the file, and the file on disk are three names for one thing,
 * and three names are three things that can come to differ. `event-schema.json`
 * arrived with §4.1 — the vectors are exemplars, the schema is the declarations —
 * and it reaches a stranger the same way, by being in the repository.
 */
const ARTIFACTS = [
  { what: 'the vectors', name: VECTORS_FILE_NAME, file: VECTORS_FILE },
  { what: 'the schema', name: SCHEMA_FILE_NAME, file: SCHEMA_FILE },
] as const;

describe('FORMAT.md points at the artifact the code resolves', () => {
  it('names the file the vectors module names, and no other vectors file', () => {
    expect(FORMAT).toContain(`\`${VECTORS_FILE_NAME}\``);
    const named = [
      ...new Set([...FORMAT.matchAll(/`([\w-]*vectors[\w-]*\.json)`/g)].map((m) => m[1])),
    ];
    expect(named).toEqual([VECTORS_FILE_NAME]);
  });

  it('names the file the schema module names, and no other schema file', () => {
    expect(FORMAT).toContain(`\`${SCHEMA_FILE_NAME}\``);
    const named = [
      ...new Set([...FORMAT.matchAll(/`([\w-]*schema[\w-]*\.json)`/g)].map((m) => m[1])),
    ];
    expect(named).toEqual([SCHEMA_FILE_NAME]);
  });

  it.each(ARTIFACTS)('points at a file that is there ($what)', ({ file }) => {
    expect(existsSync(fileURLToPath(file))).toBe(true);
  });

  it.each(ARTIFACTS)('$what is a file the repository carries, its only channel', ({ file }) => {
    // The artifact reaches a stranger by being IN the repository — it is in no npm
    // tarball, and `FORMAT.md` says so. A path that a `.gitignore` swallowed would
    // publish nothing while every other case here stayed green, and this tree
    // ignores whole directories by name (`dist/`, `scripts/`, `.refactor/`), so
    // the hazard is real rather than theoretical. `git` is asked directly.
    const relative = fileURLToPath(file).slice(REPO.length);
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
