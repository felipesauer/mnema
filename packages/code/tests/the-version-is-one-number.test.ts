/**
 * THE VERSION IS ONE NUMBER, AND EVERY MANIFEST THAT CARRIES ONE CARRIES THAT ONE.
 *
 * WHERE THIS COMES FROM. Until the release this file arrived with, the workspace published
 * exactly one package, and the number lived in twelve places nothing reconciled: five
 * `package.json` files, the plugin's manifest, `src/version.ts`, the golden transcript of
 * `--version`, and four literals typed into test files. `version.ts` said so in as many
 * words — that the constant agreeing with the manifest was "an INTENTION of this module, not
 * a promise it can point a test at" — and it was right. Nothing compared them.
 *
 * WHAT MADE IT COST SOMETHING. One package can survive a constant that disagrees with its
 * manifest: `--version` prints a wrong line and the npm page is the only other witness. Four
 * packages published from one workspace cannot, because the disagreement stops being between
 * a binary and its page and starts being between PACKAGES — `@mnema/code@0.1.0` resolving
 * `@mnema/chain@0.0.0`, which is a tree that does not install. `pnpm publish` rewrites each
 * `workspace:*` to the concrete version of the package it points at, so the versions are not
 * four independent numbers a human may choose to keep in step: they are one number the
 * resolver will read four times.
 *
 * THE LIST IS GIT'S, NEVER TYPED HERE. A list typed here stays at six while a seventh
 * manifest arrives, and goes on passing over the six it knows — the failure this workspace
 * has already measured twice, in `the-runtime-floor-is-declared-once.test.ts` (a second
 * workflow with a node matrix of its own) and in `the-sentence-reaches-every-door.test.ts`
 * (a manifest added with a home of its own). So every tracked `package.json` and
 * `plugin.json` is found, and the reconciliation runs in both directions.
 *
 * WHAT IT DOES NOT COVER, said out loud. Whether the number is the RIGHT one — that a
 * release is minor rather than major is a judgement, not a fact on disk, and no test can hold
 * it. Nor the `0.0.0` of a dependency inside `node_modules`: these are the workspace's own
 * manifests, found by git, and a vendored tree is nobody's promise here. And the literal in
 * `cli.help.golden.txt` is held to the constant, not the other way round: the golden is the
 * one place the number is spelled out, which is what makes a bump a deliberate edit instead
 * of a value that follows silently wherever it is read.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERY MANIFEST THE WORKSPACE TRACKS, ASKED OF GIT. `--others --exclude-standard` is here
 * for the same reason the runtime-floor guard carries it: a manifest added and not yet
 * committed is still a manifest this release would publish, and a guard that only saw the
 * index would pass on the working tree that is about to be tagged.
 */
const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

/** A manifest that declares a version, and what it declares. */
interface Declared {
  readonly where: string;
  readonly version: string;
}

/**
 * Every tracked manifest carrying a top-level `version`, read off the disk.
 *
 * `plugin.json` is in here beside the `package.json` files deliberately: it is a manifest a
 * host reads and shows to a user, so a plugin left at the old number is the same defect
 * wearing a different filename.
 */
const DECLARING: readonly Declared[] = TRACKED.filter(
  (where) =>
    where === 'package.json' || where.endsWith('/package.json') || where.endsWith('/plugin.json'),
).flatMap((where) => {
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(readFileSync(join(ROOT, where), 'utf-8')) as { version?: unknown };
  } catch {
    return [];
  }
  return typeof parsed.version === 'string' ? [{ where, version: parsed.version }] : [];
});

describe('the manifests this workspace ships agree on one version', () => {
  it('finds the manifests that declare one, and there are six', () => {
    // NON-VACUITY, and it is the case that matters most here: every assertion below is a
    // reduction over this list, so a sweep that found nothing would leave all of them true
    // while checking no file at all. The number is exact rather than a floor, because a
    // floor is a number anyone can lower to swallow a manifest that stopped being read.
    expect(DECLARING.map(({ where }) => where).sort()).toEqual([
      'package.json',
      'packages/chain/package.json',
      'packages/code/package.json',
      'packages/copilot/package.json',
      'packages/core/package.json',
      'plugin/.claude-plugin/plugin.json',
    ]);
  });

  it('declares exactly one number between them', () => {
    const said = [...new Set(DECLARING.map(({ version }) => version))].sort();
    expect(
      said,
      `the manifests disagree: ${DECLARING.map((d) => `${d.where}=${d.version}`).join(', ')}`,
    ).toHaveLength(1);
  });

  it('is the number the program answers with when it is asked', () => {
    // THE LINK, and the half a manifest sweep can never reach. `version.ts` is a constant
    // and not a read of the manifest — deliberately, so that `mnema --version` costs no
    // filesystem call — which is exactly what makes the two able to drift.
    const disagree = DECLARING.filter(({ version }) => version !== VERSION).map(
      ({ where, version }) => `${where} says ${version}, the program says ${VERSION}`,
    );
    expect(disagree).toEqual([]);
  });
});

describe('the number is spelled out in exactly one place', () => {
  const GOLDEN = readFileSync(join(ROOT, 'packages/code/src/cli.help.golden.txt'), 'utf-8');

  it('the golden transcript holds the bytes `--version` prints, and they are this number', () => {
    // The golden is a committed transcript of what commander writes, so this is the one
    // site where a bump has to be typed. A constant here would make the file agree with
    // itself and pin nothing.
    expect(GOLDEN).toContain(`$ mnema --version\n| ${VERSION}\n`);
  });

  /**
   * A VERSION-SHAPED LITERAL, WITH ITS NEIGHBOURS READ. The number sits inside a longer one
   * (`10.1.0` contains `0.1.0`), inside a longer fraction (`0.1.01`) and inside a prerelease
   * that is a DIFFERENT version (`0.1.0-rc1`), so the boundaries are part of the reading — an
   * instrument that accused a line for containing the digits is an instrument nobody keeps.
   * Written as a pure function of the text so the case below can hand it a corpus.
   */
  const typesTheNumber = (text: string, number: string): readonly string[] =>
    text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .filter((line) => !line.includes('VERSION'))
      .filter((line) =>
        new RegExp(`(?<![\\d.])v?${number.replace(/\./g, '\\.')}(?![\\d.-])`).test(line),
      )
      .map((line) => line.trim());

  it('no test of this workspace types the number as a literal', () => {
    // WHAT THIS ENDS, AND IT IS A13. Four test files carried `0.0.0`: one assertion on the
    // CLI's own output, which would at least have gone red on a bump, and THREE FIXTURES —
    // a session title and two screen measurements — which would not. A fixture holding
    // `mnema 0.0.0` after the product says `0.1.0` is a green suite over a title the product
    // cannot produce, and no other case in this suite would have said so. They read the
    // constant now, and this is what stops the fifth from appearing.
    const typed = TRACKED.filter(
      (where) => where.startsWith('packages/') && where.endsWith('.test.ts'),
    ).flatMap((where) =>
      typesTheNumber(readFileSync(join(ROOT, where), 'utf-8'), VERSION).map(
        (line) => `${where}: ${line}`,
      ),
    );
    expect(typed).toEqual([]);
  });

  it('the reading FIRES, and does not accuse a number that merely contains this one', () => {
    // NON-VACUITY plus the false-positive half, because a scan that found nothing anywhere
    // would satisfy the case above and measure no file at all.
    //
    // NOT ONE NUMBER HERE IS TYPED. The first draft of this case wrote `0.1.0` into its own
    // corpus and the case above then accused THIS FILE — an instrument that fires on itself,
    // which this workspace has already had once. The alternative was an exception naming this
    // file, which is a list pretending to be a rule; so the corpus is built from the constant
    // instead, and `OTHER` is derived to be a version this product cannot be at.
    const OTHER = VERSION.split('.')
      .map((part) => String(Number(part) + 1))
      .join('.');
    expect(OTHER).not.toBe(VERSION);

    expect(typesTheNumber(`const t = 'mnema ${VERSION} - a session';`, VERSION)).toHaveLength(1);
    expect(typesTheNumber(`const t = 'v${VERSION}';`, VERSION)).toHaveLength(1);
    expect(typesTheNumber(` * the release was ${VERSION}`, VERSION)).toEqual([]);
    expect(typesTheNumber(`  // bumped to ${VERSION}`, VERSION)).toEqual([]);
    expect(typesTheNumber(`const other = "1${OTHER}";`, OTHER)).toEqual([]);
    expect(typesTheNumber(`const other = "${OTHER}1";`, OTHER)).toEqual([]);
    expect(typesTheNumber(`const pre = "${OTHER}-rc1";`, OTHER)).toEqual([]);
  });
});

/**
 * THE MUTATION THAT LIGHTS IT, WRITTEN DOWN BECAUSE A STRUCTURAL GUARD IS WORTH ONLY WHAT IT
 * REDDENS ON. Both halves are exercised as pure readings here rather than by editing the
 * tree: a guard whose non-vacuity proof rewrites six manifests is a guard that can leave them
 * rewritten.
 */
describe('the guard is not vacuous', () => {
  const agree = (declared: readonly Declared[], program: string): readonly string[] =>
    declared.filter(({ version }) => version !== program).map(({ where }) => where);

  it('the tree it is measured against agrees, or the mutations below prove nothing', () => {
    expect(agree(DECLARING, VERSION)).toEqual([]);
  });

  it('reddens when ONE manifest is left behind', () => {
    const left = DECLARING.map((d, at) => (at === 0 ? { ...d, version: '0.0.0' } : d));
    expect(agree(left, VERSION)).toHaveLength(1);
    expect([...new Set(left.map((d) => d.version))]).toHaveLength(2);
  });

  it('reddens when the PROGRAM is left behind and every manifest moved', () => {
    // The other direction, and the one a release actually gets wrong: five manifests bumped
    // by a search-and-replace over `package.json`, and the constant in `src/` untouched.
    const moved = DECLARING.map((d) => ({ ...d, version: '0.2.0' }));
    expect(agree(moved, VERSION)).toHaveLength(DECLARING.length);
  });
});
