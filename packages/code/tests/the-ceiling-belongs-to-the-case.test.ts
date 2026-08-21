/**
 * THE CEILING BELONGS TO THE CASE. A case that waits — one that starts processes, or drives
 * a terminal, or walks every source the product has — says so at its own `it`, and nothing
 * lifts the ceiling the other two thousand are judged against.
 *
 * WHERE THIS COMES FROM. Cases of this suite went red under load and green on their own,
 * with a message that named no cost and no cause: the run simply stopped at five seconds.
 * The cheap repair is one line in the workspace's configuration, and it is the wrong one —
 * it buys silence for every case at once, so the next case that grows from two seconds to
 * nine arrives green and nobody learns it grew. A ceiling written at the `it` says WHICH
 * case waits, and the line beside it says on what.
 *
 * SO THE RULE IS A BAN, and it is a ban at every place that could lift the floor for
 * everybody rather than at the one that was tempting:
 *
 *   - THE WORKSPACE'S OWN CONFIGURATION, which is the obvious one.
 *   - THE COMMAND LINE THE SUITE IS STARTED FROM — a script in a manifest, or a workflow in
 *     CI, which never passes through the configuration at all.
 *   - A CALL INSIDE A FILE, which raises it for every case in that file and is invisible to
 *     anybody reading the configuration.
 *
 * All three spell the same thing, so the scan below is one needle over everything the
 * workspace ships.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered: whether a case
 * that waits actually HAS its own ceiling. That question needs a DURATION, and a scan over
 * source has none — it is answered by running the suite and reading the durations, which is
 * not something a guard can do without becoming the thing it measures.
 *
 * AND THE DURATIONS WERE READ, on 21 Aug 2026, because CI reaching this trunk made them
 * available for the first time. Of 3484 cases, 3286 wait under the shared five seconds — read
 * off the run rather than counted in the source, since a positional argument also closes a
 * `beforeAll` and the source count says 215 where the cases say 198. The slowest of the 3286,
 * over two runner runs and four local configurations:
 *
 *   GitHub runner, node 24 ................. 955 ms, 1259 ms
 *   GitHub runner, node 22 ................. 1173 ms, 1595 ms
 *   container, 4 cores, node 22 ............ 1339 ms
 *   this workstation, 16 cores, node 24 .... 1635 ms
 *   the same, under v8 coverage ............ 2412 ms
 *
 * Nothing came within three seconds of the ceiling, in any of them, so no case needs one of its
 * own today and this ban costs nothing to keep. TWO THINGS IN THAT TABLE ARE WORTH THE READING.
 * The runner is not the slow machine — 1595 ms at its worst against this workstation's 1635 ms,
 * near parity — even though the suite's wall clock there is around 3x slower (101-134 s against
 * 36 s). Fewer workers on fewer cores contend less, and the slowest cases are pty and screen
 * work that waits on the clock, so the two ratios pull opposite ways: a ceiling sized from the
 * wall-clock ratio would have been three times too loose. And coverage instrumentation charges
 * 1.48x to the worst case while charging 11.6% to the wall clock (40.2 s against 36.0 s, four
 * passes alternating), because it charges most to the heaviest cases and parallelism absorbs
 * the rest.
 *
 * A SINGLE SAMPLE WOULD HAVE MISLED. The first runner run put node 22 at 1173 ms and node 24 at
 * 1259 ms; the second reversed them, at 1595 ms and 955 ms. The spread between two runs of the
 * same commit on the same image is wider than the gap between machines, which is the reason
 * these are written as a set and not as a figure.
 *
 * SO THE REPAIR THIS BAN REFUSES WAS PRICED, and it is still the wrong one: the cheap line
 * would have been written at the number this measurement produced, and the measurement says no
 * case is anywhere near needing it.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** This file, which the scan reaches and must not accuse. */
const HERE = fileURLToPath(import.meta.url);

/**
 * What lifts the ceiling for everybody, spelled in PARTS. A needle written whole would sit
 * in this file's own source, the scan would find itself, and the guard would be red the day
 * it was written and switched off the day after.
 *
 * One pattern covers the three shapes: the key in a configuration and the argument of a call
 * are written one way, the flag on a command line the other.
 */
const LIFTS_THE_CEILING = new RegExp(`${'test'}[-_]?${'timeout'}`, 'i');

/** The extensions text is carried in here — sources, manifests, and CI's own files. */
const TEXT = /\.(ts|mts|cts|js|mjs|cjs|json|ya?ml)$/;

/** Every text file under `where`; `deep` walks it, and what is built or installed is not it. */
function filesUnder(where: string, deep: boolean): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(where, { withFileTypes: true })) {
    const path = join(where, entry.name);
    if (entry.isDirectory()) {
      if (!deep) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      found.push(...filesUnder(path, true));
    } else if (TEXT.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * What a measurement CAPTURED, which is the one thing under `measurements/` the needle stays
 * off. A run writes the agent's own output there, per cell, and a needle over text a model
 * wrote accuses nobody: it would turn this guard red for a reason that is not a defect. Data
 * is not configuration.
 */
const CAPTURED_OUTPUT = /^measurements\/[^/]+\/results\//;

/**
 * Everything the workspace SHIPS that could configure a run: its own files at the root, the
 * packages, CI, and the measurements.
 *
 * THE SENTENCE THAT STOOD HERE said the workbench directories are local-only and ignored by
 * git, so they are not part of the tree this rule is about — and it was the whole account of
 * what the scan leaves out. `measurements/` falsified it: it is committed, it is a directory,
 * and a scan that does not descend from the root would have skipped it in silence while this
 * comment still explained the exclusion by an ignoredness that no longer covered it. So the
 * tree is scanned rather than excused, and a manifest or a script that lands there tomorrow is
 * covered without anybody having to remember this file.
 */
const SCANNED: readonly string[] = [
  ...filesUnder(ROOT, false),
  ...filesUnder(join(ROOT, 'packages'), true),
  ...filesUnder(join(ROOT, '.github'), true),
  ...measurementsUnder(ROOT),
];

/**
 * The measurements tree of `root`, minus what a run captured — the walk and the one exclusion,
 * written as a function so the case below can put it over a tree of its OWN.
 *
 * THE SENTENCE THAT STOOD HERE said this workspace has nothing to exclude yet, because no run
 * had produced a capture, so a check of the exclusion against the real tree would pass just as
 * well with the exclusion deleted. The pilot falsified it on 17 Aug 2026 and the round on the
 * 18th: a cell's raw output is committed as `<cell>.stdout.json`, and `.json` is exactly what
 * TEXT matches. So the exclusion now removes real files from the real walk, and the case below
 * asserts THAT rather than only the shape — while the tree of its own stays, because it is what
 * pins which files the pattern lets through.
 */
function measurementsUnder(root: string): readonly string[] {
  return filesUnder(join(root, 'measurements'), true).filter(
    (file) => !CAPTURED_OUTPUT.test(file.slice(root.length)),
  );
}

describe('the ceiling a case waits under is that case’s own', () => {
  it('is lifted nowhere the workspace configures a run', () => {
    const lifting = SCANNED.filter((file) => LIFTS_THE_CEILING.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(ROOT.length))
      .sort();
    expect(lifting, 'something raises the ceiling for every case at once').toEqual([]);
    // THE SCAN REACHES ALL THREE PLACES, or the line above is true of nothing: the
    // workspace's configuration, the manifests a run is started from, and the files
    // themselves, where one call would cover a whole file at a time.
    const reached = SCANNED.map((file) => file.slice(ROOT.length));
    expect(reached, 'the configuration itself was not read').toContain('vitest.config.ts');
    expect(reached, 'no manifest was read').toContain('package.json');
    expect(
      reached.filter((file) => file.endsWith('.test.ts')).length,
      'the files that hold the cases were not read',
    ).toBeGreaterThan(100);
    expect(
      reached.filter((file) => file.startsWith('.github/')).length,
      'CI, which starts the suite without the configuration, was not read',
    ).toBeGreaterThan(0);
    // AND IT CANNOT FIND ITSELF. The needle is spelled in parts for exactly this: a file is
    // accused for lifting the ceiling, never for naming what it bans.
    expect(readFileSync(HERE, 'utf-8'), 'the scan finds itself').not.toMatch(LIFTS_THE_CEILING);
  });

  it('and would find one, in each of the three shapes that lift it', () => {
    // Non-vacuity on text this case owns, one line per shape the ban is about — and each
    // written in parts, because a sample spelled whole would put this file in the list.
    const key = ['test', 'Timeout'].join('');
    const flag = ['test', 'timeout'].join('-');
    expect(
      LIFTS_THE_CEILING.test(`export default defineConfig({ test: { ${key}: 60_000 } });`),
    ).toBe(true);
    expect(LIFTS_THE_CEILING.test(`"test": "vitest run --${flag}=60000"`)).toBe(true);
    expect(LIFTS_THE_CEILING.test(`vi.setConfig({ ${key}: 60_000 });`)).toBe(true);
    // And it is not true of anything: a ceiling written at a case is the shape this rule
    // EXISTS to leave alone, and prose about a case that waited is not a configuration.
    expect(LIFTS_THE_CEILING.test('  }, 60_000);')).toBe(false);
    expect(LIFTS_THE_CEILING.test('the case timed out, and the test said which one')).toBe(false);
  });

  it('reads what a measurement FIXED', () => {
    // The tree the workspace started shipping when a protocol was pre-registered. It is
    // committed, so it is inside the needle like every other committed file — and this line
    // is what says the walk above actually descends into it.
    const reached = SCANNED.map((file) => file.slice(ROOT.length));
    expect(reached, 'the measurements were not read').toContain('measurements/p1/split.json');
  });

  it('and not what a measurement captured — over the real tree', () => {
    // The exclusion has to be DOING something here, or the two cases below say nothing about
    // this workspace: a run's raw output is committed per cell as `<cell>.stdout.json`, which
    // the needle's own extension list matches. Deleting the exclusion puts a model's output
    // into the scan, and a needle over text a model wrote accuses nobody.
    const scanned = filesUnder(join(ROOT, 'measurements'), true);
    const kept = measurementsUnder(ROOT);
    expect(
      scanned.length - kept.length,
      'the exclusion excludes nothing in this workspace — it cannot have gone red',
    ).toBeGreaterThan(0);
    // And it excludes the captures only: what a measurement FIXED is still read.
    expect(kept.map((file) => file.slice(ROOT.length))).toContain('measurements/p1/split.json');
  });

  it('and the pattern it excludes by lets a pre-registration through — over a tree of its own', () => {
    // A TREE OF ITS OWN, because over the real one the case above can only count: which files
    // the pattern lets through and which it stops needs a tree whose every file is known, and
    // here deleting the exclusion goes red on an exact list rather than on a count.
    const root = `${mkdtempSync(join(tmpdir(), 'mnema-ceiling-'))}/`;
    try {
      const captured = join(root, 'measurements', 'p1', 'results', '2026-08-20-full', 'raw');
      mkdirSync(captured, { recursive: true });
      writeFileSync(join(captured, 'a1-rounding-base-r1.stdout.json'), '{"result":"done"}');
      writeFileSync(join(root, 'measurements', 'p1', 'split.json'), '{"pilot":"a1-rounding"}');

      expect(measurementsUnder(root).map((file) => file.slice(root.length))).toEqual([
        join('measurements', 'p1', 'split.json'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
