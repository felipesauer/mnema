/**
 * THE INDEX NAMES THE RUNS THAT EXIST, AND NAMES NO OTHER.
 *
 * WHERE THIS COMES FROM. `measurements/p1/results/README.md` has been wrong about which run
 * directories are under it FOUR times, in two shapes, and every one of them was found by a human
 * sweeping prose rather than by anything that runs:
 *
 *   - THREE STALE COUNTS. "The pilot has run; the round has not", then "the pilot and the first
 *     round", then "the pilot and TWO rounds" — each true on the day it was written and false the
 *     next time a run landed beside it. That file records all three, because the previous apology
 *     did not prevent the next one.
 *   - ONE NAME THAT WAS NEVER TRUE. The example paragraph named `2026-08-14-pilot/`; the pilot
 *     landed as `2026-08-17-pilot/`. No run growing the folder would ever have made that right,
 *     and it survived three corrections of the paragraphs around it.
 *
 * THAT FILE'S OWN READING of three occurrences was that this is *"a defect of form, not of
 * attention"*, and it closed by saying the sweep *"catches this file and does not fix it"*. This
 * case is what makes the second half false. The names cannot be DERIVED into prose — there is no
 * generator over these READMEs, and inventing one to template two paragraphs would be a build step
 * nobody would keep — so the form is fixed the other way: the prose stays hand-written and stops
 * being unchecked.
 *
 * IT READS BOTH DIRECTIONS, and only the second one catches a stale count. A directory the prose
 * names that is not on disk is the `2026-08-14-pilot/` shape. A directory on disk that the prose
 * does not name is the stale-count shape — the fifth run landing beside a sentence that says
 * there are four. One direction alone would have caught one of the two defects this file has
 * actually had.
 *
 * IT READS CLAIMS, NOT MENTIONS — and finding that out is what this case cost. Written to read
 * every mention, it went red on its own fix: the paragraph recording the `2026-08-14-pilot/` error
 * has to CONTAIN `2026-08-14-pilot/` to record it, and this base's rule is that a falsified premise
 * is rewritten and never deleted. So a rule over mentions is in direct conflict with the rule that
 * keeps the history, and the conflict is not a detail — it would have made every future correction
 * to these files impossible to write.
 *
 * THE DISCRIMINANT IS THE ITALIC PARENTHETICAL, `*(…)*`, which is not invented here: all eight of
 * them across these two files are records of a premise that fell, and nothing else in either file
 * uses the form. Inside one, a run directory is being QUOTED; outside one, it is being CLAIMED.
 * Only claims are held to existing. And the exclusion has to earn itself — a case below fails if
 * stripping those blocks changes nothing, because an inert exclusion is a hole that looks like a
 * rule.
 *
 * WHAT IT DOES NOT COVER. The numbers. This case knows that `2026-08-21-full/` is named; it does
 * not know that the sentence naming it says 160 cells and that 160 is what `cells.jsonl` holds.
 * Reading the count out of the prose means parsing the prose, and a case that guesses which digit
 * in a sentence is a cell count is a case that goes wrong quietly. The counts are checked where
 * the counts are data — the reading, not the README.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Where the captures land. One directory per run, named for its date and mode. */
const RESULTS = 'measurements/p1/results';

/**
 * THE TWO FILES A READER USES TO KNOW WHAT RAN. Both are checked, because the correction for
 * `2026-08-18-full/` says explicitly that it *"lives here and in the index"* — so a fix landing
 * in one and not the other is the shape this pair exists to refuse.
 */
const NAMING = [`${RESULTS}/README.md`, 'measurements/README.md'] as const;

/**
 * A run directory as the prose writes it: a date and a mode.
 *
 * THE MODE IS ONE OR MORE WORDS, and it took a two-word one to find that out. `[a-z]+` followed
 * by `\b` reads `2026-08-24-sieve-aborted/` as `2026-08-24-sieve` — the boundary sits between the
 * `e` and the hyphen — so the guard reported a directory that is not on disk while the one that
 * is went unnamed. Both directions went red at once, on a name that was correct.
 *
 * The widening is not a loosening of what counts as a claim: the shape is still a full date and
 * then words, and the case below holds it to refusing the near misses. What it stops doing is
 * truncating a name in the middle.
 */
const A_RUN = /\b(20\d{2}-\d{2}-\d{2}-[a-z]+(?:-[a-z]+)*)\b/g;

/**
 * A RECORD OF A PREMISE THAT FELL. Every one of these in these two files is a correction kept
 * rather than deleted, and a correction about a wrong name must be free to write the wrong name.
 */
const A_QUOTED_PAST = /\*\((?:.|\n)*?\)\*/g;

const claimsIn = (text: string): readonly string[] => [
  ...new Set([...text.replace(A_QUOTED_PAST, '').matchAll(A_RUN)].map((m) => m[1] ?? '')),
];

/** What is actually on disk. */
const ON_DISK: readonly string[] = readdirSync(join(ROOT, RESULTS), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** What each file names, deduplicated, in the order the file first mentions it. */
const NAMED: readonly {
  readonly where: string;
  readonly runs: readonly string[];
  readonly mentions: readonly string[];
}[] = NAMING.map((where) => ({
  where,
  runs: claimsIn(readFileSync(join(ROOT, where), 'utf-8')),
  mentions: [
    ...new Set(
      [...readFileSync(join(ROOT, where), 'utf-8').matchAll(A_RUN)].map((m) => m[1] ?? ''),
    ),
  ],
}));

describe('the index names the runs that exist', () => {
  it('read something in the first place', () => {
    // NOT VACUOUS: a move of `measurements/`, a rename of the READMEs, or a mode that stops
    // matching the shape would leave both directions below comparing two empty lists and
    // agreeing. Five runs are on disk today and both files name them.
    expect(ON_DISK.length, 'no run directory was found on disk at all').toBeGreaterThan(3);
    for (const { where, runs } of NAMED) {
      expect(runs.length, `${where} names no run directory at all`).toBeGreaterThan(3);
    }
  });

  it('earns the blocks it skips, rather than skipping them for nothing', () => {
    // AN INERT EXCLUSION IS A HOLE. If no `*(…)*` block in either file quotes a run directory,
    // then stripping them changes no answer and this whole mechanism is a rule that reads as
    // careful and does nothing — so it should be deleted rather than trusted. Today the block
    // recording the `2026-08-14-pilot/` error is exactly what makes it load-bearing.
    const quoting = NAMED.filter((n) => n.mentions.length > n.runs.length);
    expect(
      quoting.map((n) => n.where),
      'no record-of-a-fallen-premise quotes a run directory, so skipping those blocks does nothing',
    ).not.toEqual([]);
  });

  it('reads a run name whole, and still refuses what is not one', () => {
    // THE WIDENING EARNS ITSELF HERE. A pattern that reads more has to be shown still to refuse,
    // or "it matches the two-word mode now" is indistinguishable from "it matches anything".
    const read = (text: string): readonly string[] =>
      [...text.matchAll(new RegExp(A_RUN.source, 'g'))].map((m) => m[1] ?? '');

    expect(read('`2026-08-24-sieve-aborted/` holds 55 cells')).toEqual(['2026-08-24-sieve-aborted']);
    expect(read('`2026-08-21-full/` holds 160')).toEqual(['2026-08-21-full']);
    // And the near misses, none of which is a run directory:
    expect(read('on 2026-08-24 a sieve of 128 cells')).toEqual([]);
    expect(read('the round of 2026-08-24')).toEqual([]);
    expect(read('schema mnema-bench/cell/8')).toEqual([]);
    expect(read('2026-08-24-Full')).toEqual([]);
  });

  it('names nothing that is not there', () => {
    // The `2026-08-14-pilot/` shape: a directory that never existed, named for three days.
    for (const { where, runs } of NAMED) {
      const absent = runs.filter((run) => !ON_DISK.includes(run));
      expect(absent, `${where} names a run directory that is not under ${RESULTS}/`).toEqual([]);
    }
  });

  it('leaves nothing out that is there', () => {
    // The stale-count shape: a run lands and the sentence beside it still describes the tree as
    // it was. This is the direction that turns "wrong for the fourth time" into "red on landing".
    for (const { where, runs } of NAMED) {
      const missing = ON_DISK.filter((run) => !runs.includes(run));
      expect(missing, `${where} does not name a run directory that exists`).toEqual([]);
    }
  });
});
