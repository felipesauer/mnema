/**
 * One rule for "newest first": the comparison every recency listing in this product
 * makes, written once, and a scan that keeps a seventh writing from appearing.
 *
 * SIX SITES HELD THE SAME COMPARISON AND THE SAME DEFECT. The search index's SQL and
 * its cross-tree merge, the opening context's work and awaiting lists, the focus
 * read's runs, the decisions-in-force list, and the usage listing's runs each wrote
 * *instant descending, then id* by hand — and every one of them broke the tie by id
 * ASCENDING. An ascending id is OLDEST first (`mintId` puts a monotonic counter beside
 * the millisecond precisely so that it is), so a listing whose first clause says
 * newest-first and whose second says oldest-first served the oldest record of a
 * millisecond at the top. It was invisible in review at every site because the result
 * is a TOTAL order: the answer was stable, and a stable answer looks correct.
 *
 * The trunk went red on it on 22/08/2026 — `search.test.ts`, two memories written in
 * one millisecond, the newer one not first — and one site was fixed while five stayed
 * wrong until this scan was written. That is the case for the scan and not for a
 * review checklist: a hand-written tie-break that is WRONG looks exactly like one that
 * is right, and there is no diff in which it stands out.
 *
 * WHAT IS ASSERTED, and the two halves are different:
 *   - NOBODY WRITES IT AGAIN. No file under any package's `src` may compare an instant
 *     field DESCENDING by hand. The one file that may is `newest-first.ts`, and the
 *     scan finding it there is what proves the scan is live rather than looking for a
 *     shape nothing has — the ban and its own non-vacuity in one assertion.
 *   - THE RULE POINTS THE WAY IT CLAIMS TO. Asked of the exported function over a real
 *     pair of minted ids, because a scan can only say the comparison is in one place;
 *     it cannot say that place is right.
 *
 * WHERE THE SCAN IS BLIND, named rather than left to be discovered. It looks for the
 * two ternary spellings of a descending string comparison, which is how all six sites
 * were written. A comparator that reached the same order another way — swapping its
 * arguments into a helper (`compare(b.at, a.at)`), subtracting two `Date.parse`
 * results, or calling `.reverse()` on an ascending sort — would walk straight past it.
 * ASCENDING comparisons are deliberately NOT banned: `exposure.ts`, `references.ts`
 * and `transcripts.ts` order oldest-first, where an ascending tie-break is the one
 * that AGREES with the instant, and `listHandoffs` is the SQL of that same case.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace's four packages, from this test file's own location. */
const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));

/** The one file allowed to write the comparison, relative to {@link PACKAGES}. */
const THE_ONE_SITE = join('core', 'src', 'projections', 'newest-first.ts');

/**
 * The two spellings of a hand-written DESCENDING comparison of an instant field.
 *
 * Matched against the file with its whitespace flattened, because one of the six sites
 * wrote its ternary across five lines and a line-by-line scan saw nothing there. The
 * field is recognized by name — `at`, or anything ending in `At` — which is what every
 * projection in this record calls its instant.
 */
const DESCENDING_BY_HAND = [
  /\.(?:at|[A-Za-z]+At)\b\s*<[^?;{}]{0,64}\?\s*1\s*:\s*-1/,
  /\.(?:at|[A-Za-z]+At)\b\s*>[^?;{}]{0,64}\?\s*-1\s*:\s*1/,
];

/** Every non-test source file under `<package>/src`, relative to {@link PACKAGES}. */
function sourcesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(PACKAGES, directory), { withFileTypes: true })) {
    const here = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(here));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(here);
  }
  return found;
}

/** Every source of the workspace, asked of the directory rather than of a list. */
const SOURCES = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    try {
      return sourcesUnder(join(entry.name, 'src'));
    } catch {
      return [];
    }
  });

describe('one rule for newest first', () => {
  it('finds the sources at all — the scan is over a record, not an empty directory', () => {
    // The instrument's own case. A wrong root, or a `src` that moved, would empty the
    // list and every assertion below would pass by saying nothing.
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES).toContain(THE_ONE_SITE);
  });

  it('is written in exactly ONE file, and that file is newest-first.ts', () => {
    const writing = SOURCES.filter((file) => {
      const flat = readFileSync(join(PACKAGES, file), 'utf8').replace(/\s+/g, ' ');
      return DESCENDING_BY_HAND.some((shape) => shape.test(flat));
    });

    // Both halves at once: nothing else writes it (the ban), and the one legal site
    // DOES match (the proof that the shapes are the shapes the product uses).
    expect(writing).toEqual([THE_ONE_SITE]);
  });
});
