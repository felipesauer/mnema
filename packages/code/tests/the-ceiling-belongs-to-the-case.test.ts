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
 * written as a function so the case below can put it over a tree of its OWN. Over this
 * workspace it has nothing to exclude yet, because no run has produced a capture: a check of
 * the exclusion against the real tree would pass just as well with the exclusion deleted.
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

  it('and not what a measurement captured — over a tree of its own', () => {
    // A TREE OF ITS OWN, because this workspace has no capture yet: over the real one the
    // exclusion has nothing to exclude, and a case that read only the real one would stay
    // green with the exclusion deleted. Here the capture exists, so deleting it goes red.
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
