// @reads-the-tree
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
 *     document is checked against them, never the other way round.
 *   - a CITATION that no longer resolves. Every behavioural claim in the document
 *     names the test that holds it; a renamed or deleted test turns that citation
 *     into a claim with nothing behind it, which is the exact thing the citations
 *     exist to prevent.
 *   - a POINTER to an artifact, of which there are now TWO: the document tells a
 *     stranger to download `canonical-vectors.json` (the exemplars) and
 *     `event-schema.json` (the declarations), and a module resolves each of them by
 *     path. Two names for one file is two names that can come to differ, so the
 *     document is checked against each module's own constant, and each file is
 *     checked to be one the repository actually carries. That used to read "the only
 *     channel they travel by"; since `@mnema/chain` is released with both artifacts
 *     inside its `files`, there are two, and the tarball half is held by
 *     `packages/code/tests/what-a-package-publishes-is-what-its-page-promises.test.ts`
 *     (see the document's last section).
 *
 * WHAT IS DELIBERATELY NOT HELD HERE: whether each claim is TRUE. That is the
 * cited test's job, and a guard that tried to do it here would be a second
 * implementation of every one of them.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NAMED_SCHEME, SCHEME } from './chain/checkpoint.js';
import { ENTRY_DOMAIN, ROOT_DOMAIN } from './chain/hash.js';
import { RECORD_DOMAIN } from './chain/record-name.js';
import { NAMED_TAILPROOF_SCHEME, TAILPROOF_SCHEME } from './chain/tailproof.js';
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
    expect([...new Set(written)].sort()).toEqual([ENTRY_DOMAIN, RECORD_DOMAIN, ROOT_DOMAIN].sort());
  });

  it('writes no scheme tag the code does not export', () => {
    // The pattern is the CLASS, not the instance: this codebase has more than one
    // `mnema-<thing>/<n>` scheme, and a document that grew a section about another one
    // would name a version no guard here read. So any scheme tag the document writes has
    // to be a constant the code exports: a new section has to export its own before it
    // can name it.
    //
    // THE TAIL PROOF IS THE SECTION THAT ARRIVED. This case expected exactly the
    // checkpoint's scheme for as long as the document said nothing about `tailproof.json`,
    // which is how an artifact sat in every tail directory, signed, with no description
    // anywhere. An independent verifier written from this document found it and had to try
    // five candidate messages to learn what it signs (gap G10). The document has a section
    // for it now, so the expected set is both exported constants, and a THIRD scheme still
    // has to export its own to be nameable.
    const written = [...FORMAT.matchAll(/mnema-[a-z]+\/\d+/g)].map((m) => m[0]);
    expect(written.length).toBeGreaterThan(0);
    // Section 6.10 is the second section that arrived: each artifact has a second scheme,
    // naming the record, and both are read beside the first.
    expect([...new Set(written)].sort()).toEqual(
      [SCHEME, NAMED_SCHEME, TAILPROOF_SCHEME, NAMED_TAILPROOF_SCHEME].sort(),
    );
  });
});

describe('FORMAT.md cites tests that exist', () => {
  /** Every repo-relative test path the document names inside backticks. */
  const cited = [
    ...new Set([...FORMAT.matchAll(/`(packages\/[^`]+\.test\.ts)`/g)].map((m) => m[1])),
  ];

  it('names at least one test per section that makes a claim', () => {
    // The document has eight sections that assert behaviour. The floor is not the
    // section count (sections move), but it is high enough that a rewrite which
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
 * arrived with §4.1 (the vectors are exemplars, the schema is the declarations)
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

  it.each(ARTIFACTS)('$what is a file the repository carries', ({ file }) => {
    // THIS CASE WAS TITLED "its only channel", AND IT HAD STOPPED BEING ONE. The prose
    // here read "it is in no npm tarball, and `FORMAT.md` says so"; `@mnema/chain` is
    // released now and its `files` carries both artifacts, so the tarball is a second
    // address and `FORMAT.md` says THAT. What this case holds is unchanged and still
    // needed: a path that a `.gitignore` swallowed would publish nothing while every
    // other case here stayed green, and this tree ignores whole directories by name
    // (`dist/`, `scripts/`), so the hazard is real rather than
    // theoretical. `git` is asked directly. The tarball half is somebody else's case:
    // `packages/code/tests/what-a-package-publishes-is-what-its-page-promises.test.ts`
    // packs the package and runs the verifier out of it.
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

/**
 * THE COUNTS THE PAGES SPELL ARE THE COUNTS THE ARTIFACTS HOLD. The opening of this document,
 * the verifier's page, this package's page and the guide to verifying without installing say how
 * many vectors the second reader reproduces, how many aggregate digests, and how many points the
 * writing of that reader found where the document was not enough. Each number was written by
 * hand, and a number written by hand is a claim with no test beside it: a vector or a gap added
 * would leave every page saying the old count. So each count is read off the artifact that holds
 * it (the vectors file, and the registry the second reader prints with `--json gaps`) and every
 * place the pages spell it, in digits or in words, is held to it.
 */
const PAGES = [
  { page: 'packages/chain/FORMAT.md', vectors: 1, aggregates: 1, gaps: 2, signed: 1 },
  { page: 'packages/chain/verifier/README.md', vectors: 2, aggregates: 1, gaps: 2, signed: 0 },
  { page: 'packages/chain/README.md', vectors: 1, aggregates: 1, gaps: 1, signed: 0 },
  { page: 'docs/verify-without-installing.md', vectors: 0, aggregates: 0, gaps: 1, signed: 0 },
] as const;

const UNITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** A count as a page spells it, in digits or in English words below a hundred; else undefined. */
function countOf(word: string): number | undefined {
  const lower = word.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  const unit = UNITS.indexOf(lower);
  if (unit >= 0) return unit;
  const [tens, ones] = lower.split('-');
  const ten = TENS.indexOf(tens ?? '');
  if (ten < 2) return undefined;
  if (ones === undefined) return ten * 10;
  const one = UNITS.indexOf(ones);
  return one >= 1 && one <= 9 ? ten * 10 + one : undefined;
}

/** Every count a page spells in front of `pattern`, whitespace and line breaks folded. */
function spelled(text: string, pattern: RegExp): number[] {
  const folded = text.replace(/\s+/g, ' ');
  return [...folded.matchAll(pattern)]
    .map((m) => countOf(m[1] ?? ''))
    .filter((n): n is number => n !== undefined);
}

describe('the pages spell the counts the artifacts hold', () => {
  const published = JSON.parse(readFileSync(VECTORS_FILE, 'utf-8')) as {
    readonly vectors: readonly unknown[];
    readonly chain: Readonly<Record<string, unknown>>;
    readonly signedMessages: { readonly vectors: readonly unknown[] };
  };
  const signed = published.signedMessages.vectors.length;
  // An aggregate is an entry of `chain` that carries a digest: a bare one, or an entry hash.
  const aggregates = Object.values(published.chain).filter(
    (value) =>
      (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) ||
      (typeof value === 'object' && value !== null && 'entryHash' in value),
  ).length;
  const gaps = (() => {
    const run = spawnSync(
      'python3',
      [fileURLToPath(new URL('verifier/mnema_verify.py', PACKAGE)), '--json', 'gaps'],
      { encoding: 'utf-8' },
    );
    if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
    return (JSON.parse(run.stdout) as { readonly gaps: readonly unknown[] }).gaps.length;
  })();

  it('reads counts that are there to read', () => {
    expect(published.vectors.length).toBeGreaterThan(0);
    expect(aggregates).toBeGreaterThan(0);
    expect(gaps).toBeGreaterThan(0);
  });

  it.each(PAGES)('$page', ({ page, ...floor }) => {
    const text = readFileSync(`${REPO}${page}`, 'utf-8');
    const said = {
      // "the twenty-three vectors published when this was found" is a count of its day, not of
      // today, and says so; it is the one spelling left out.
      vectors: spelled(text, /\b(\S+) (?:published )?vectors\b(?! published when)/gi),
      aggregates: spelled(text, /\b(\S+) aggregate digests?\b/gi),
      signed: spelled(text, /\b(\S+) (?:published )?signed messages\b/gi),
      gaps: spelled(
        text,
        /\b(\S+) (?:(?:points|places) where (?:this|the) (?:document|specification) was|of them did)\b/gi,
      ),
    };
    // NON-VACUITY: a page that stopped spelling a count would pass a check over what it spells.
    expect(said.vectors.length).toBeGreaterThanOrEqual(floor.vectors);
    expect(said.aggregates.length).toBeGreaterThanOrEqual(floor.aggregates);
    expect(said.gaps.length).toBeGreaterThanOrEqual(floor.gaps);
    expect(said.signed.length).toBeGreaterThanOrEqual(floor.signed);
    expect(said.vectors.filter((n) => n !== published.vectors.length)).toEqual([]);
    expect(said.aggregates.filter((n) => n !== aggregates)).toEqual([]);
    expect(said.gaps.filter((n) => n !== gaps)).toEqual([]);
    expect(said.signed.filter((n) => n !== signed)).toEqual([]);
  });
});
