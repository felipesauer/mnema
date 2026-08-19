/**
 * What an address covers, over a working tree the case DECLARES.
 *
 * The derivation takes the walk as a parameter precisely so a case can state what the
 * tree holds without creating one — which is the same reason the reading beside it
 * takes its disk probe injected, and it is what lets a ceiling and an unreadable
 * directory be tested at all.
 *
 * These cases are the whole of the arithmetic: the surface that owns a disk decides
 * WHICH files are counted (`code/src/governed-tree.ts`), and
 * `code/tests/the-address-says-what-it-covers.test.ts` holds that half against a real
 * tree.
 */

import { describe, expect, it } from 'vitest';
import { type AddressReach, addressReach, type WalkOutcome } from './governance.js';

const ROOT = '/work/repo';

/** A walk that emits exactly `files`, leaving nothing out. */
function holding(files: readonly string[], outcome: Partial<WalkOutcome> = {}): AddressReach {
  return addressReach({
    address: ADDRESS,
    root: ROOT,
    tree: {
      walk: (visit) => {
        for (const f of files) visit(f);
        return { skipped: [], truncated: false, ...outcome };
      },
    },
  });
}

/** The address every case above uses; a case that means another one calls `at` instead. */
const ADDRESS = 'src/collate';

/** The same walk, asked about a different address. */
function at(address: string, files: readonly string[]): AddressReach {
  return addressReach({
    address,
    root: ROOT,
    tree: {
      walk: (visit) => {
        for (const f of files) visit(f);
        return { skipped: [], truncated: false };
      },
    },
  });
}

const TREE = [
  'src/collate/fold.ts',
  'src/collate/deep/nested/leaf.ts',
  'src/collate_test.rb',
  'src/billing/charge.ts',
  'README.md',
];

describe('what an address covers', () => {
  it('counts the files under it and the files counted at all', () => {
    const reach = holding(TREE);
    expect(reach.under).toBe(2);
    expect(reach.counted).toBe(5);
    expect(reach.address).toBe('src/collate');
  });

  it('does NOT count a sibling whose name merely starts the same', () => {
    // The same claim the reading's own prefix case makes, asserted on THIS side of it:
    // a reach computed by a string prefix would report 3, and the number printed to
    // inform somebody would describe an address the gate does not stop on.
    expect(holding(['src/collate/fold.ts', 'src/collate_test.rb']).under).toBe(1);
  });

  it('counts the address itself when the address names a file', () => {
    expect(at('README.md', TREE).under).toBe(1);
  });

  it('covers everything when the address is the project root', () => {
    for (const spelling of ['.', '', './']) {
      const reach = at(spelling, TREE);
      expect(reach.address, spelling).toBe('.');
      expect(reach.under, spelling).toBe(5);
      expect(reach.counted, spelling).toBe(5);
    }
  });

  it('normalizes an address exactly as the reading does', () => {
    // Absolute-under-root, a trailing slash, a `.` segment and a `..` that climbs back:
    // every spelling is the SAME address, because both go through `relativeSegments`.
    for (const spelling of [
      'src/collate',
      'src/collate/',
      './src/collate',
      'src/./collate',
      'src/billing/../collate',
      `${ROOT}/src/collate`,
    ]) {
      expect(at(spelling, TREE).address, spelling).toBe('src/collate');
      expect(at(spelling, TREE).under, spelling).toBe(2);
    }
  });

  it('carries NO address when it lies outside the project, and covers nothing', () => {
    const reach = at('/etc/passwd', TREE);
    expect(reach.address).toBeUndefined();
    expect(reach.under).toBe(0);
    // The base still travels: "outside this project" is a different answer from "this
    // project holds no files", and a caller that printed 0/0 would merge them.
    expect(reach.counted).toBe(5);
  });

  it('answers zero over an empty tree without pretending the address is outside', () => {
    const reach = holding([]);
    expect(reach).toEqual({
      address: 'src/collate',
      under: 0,
      counted: 0,
      skipped: [],
      truncated: false,
    });
  });

  it('carries what the walk left out, verbatim', () => {
    const reach = holding(TREE, { skipped: ['node_modules', 'dist'] });
    expect(reach.skipped).toEqual(['node_modules', 'dist']);
  });

  it('carries the truncation flag, so a cut count never passes as a whole one', () => {
    expect(holding(TREE, { truncated: true }).truncated).toBe(true);
    expect(holding(TREE).truncated).toBe(false);
  });

  it('walks ONCE — the two numbers cannot come from two passes', () => {
    let walks = 0;
    addressReach({
      address: ADDRESS,
      root: ROOT,
      tree: {
        walk: (visit) => {
          walks += 1;
          for (const f of TREE) visit(f);
          return { skipped: [], truncated: false };
        },
      },
    });
    expect(walks).toBe(1);
  });
});
